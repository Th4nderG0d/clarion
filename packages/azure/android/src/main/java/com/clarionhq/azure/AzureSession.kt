package com.clarionhq.azure

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.microsoft.cognitiveservices.speech.CancellationErrorCode
import com.microsoft.cognitiveservices.speech.CancellationReason
import com.microsoft.cognitiveservices.speech.OutputFormat
import com.microsoft.cognitiveservices.speech.PhraseListGrammar
import com.microsoft.cognitiveservices.speech.ProfanityOption
import com.microsoft.cognitiveservices.speech.PropertyId
import com.microsoft.cognitiveservices.speech.RecognitionResult
import com.microsoft.cognitiveservices.speech.ResultReason
import com.microsoft.cognitiveservices.speech.SpeechConfig
import com.microsoft.cognitiveservices.speech.audio.AudioConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URI
import java.util.UUID

/**
 * Drives an Azure SDK recognizer in continuous mode (speech-recognition by
 * default, conversation-transcriber when `config.enableSpeakerDiarization` is
 * true) and surfaces partials/finals/errors via [AzureCallbacks].
 * Lifecycle: prepare → start → (events) → stop/discard → release.
 */
internal class AzureSession(
  private val context: Context,
  private val config: AzureConfig,
  private val callbacks: AzureCallbacks,
) : AzureRecognizerCallbacks {

  private var speechConfig: SpeechConfig? = null
  private var audioConfig: AudioConfig? = null
  private var engine: AzureRecognizerEngine? = null
  private var focusMonitor: AudioFocusMonitor? = null

  /** Phrase finals accumulated during the session — stitched together on stop(). */
  private val accumulatedFinals = mutableListOf<String>()
  /** Latest partial — fallback when stop() lands before any final. */
  @Volatile private var latestPartial: String = ""

  private var sessionId: String = ""
  private var sessionStartMs: Double = 0.0

  /** True between start() and stop/discard/release. */
  @Volatile private var active: Boolean = false
  /**
   * Epoch-ms until which we keep accepting tail Recognized events that arrive
   * after [stop] returned. Zero/past = closed.
   */
  @Volatile private var tailWindowEndMs: Long = 0L
  @Volatile private var released: Boolean = false

  companion object {
    /** How long after stop() we keep listening for tail Recognized events. */
    private const val TAIL_WINDOW_MS: Long = 2_000L
  }

  // MARK: Lifecycle

  suspend fun prepare() {
    if (released) throw AzureError("ENGINE_NOT_READY", "Session was released")

    ensureMicPermission()
    validateAuthConfig()
    installFocusMonitor()

    try {
      val cfg = buildSpeechConfig()
      val audio = AudioConfig.fromDefaultMicrophoneInput()
      val recEngine: AzureRecognizerEngine = buildEngine(cfg, audio)
      this.speechConfig = cfg
      this.audioConfig = audio
      this.engine = recEngine

      // Install custom-vocab phrase hints (no-op if list is empty).
      installPhraseHints()

      // NOTE: WebSocket pre-warm via `Connection.openConnection(true)` was
      // removed for parity with iOS — the equivalent SDK call there crashes
      // (SIGTRAP) on some configurations. The first `start()` pays the
      // ~500-1000 ms handshake instead. The JS-side auth pre-flight in
      // AzureEngine.prepare() already catches bad keys/regions early.
    } catch (e: AzureError) {
      throw e
    } catch (t: Throwable) {
      throw AzureErrorMapping.map(t)
    }
  }

  /**
   * Pick the right SDK class based on `enableSpeakerDiarization`. If the
   * diarization path throws and `degradeOnTierMismatch` is on, fall back to
   * the regular SpeechRecognizer and emit an informational error so the JS
   * layer can show a DEGRADED_MODE notice.
   */
  private fun buildEngine(cfg: SpeechConfig, audio: AudioConfig): AzureRecognizerEngine {
    if (!config.enableSpeakerDiarization) {
      return AzureSpeechRecognizerEngineImpl(cfg, audio, this)
    }
    return try {
      AzureConversationTranscriberEngineImpl(cfg, audio, this)
    } catch (t: Throwable) {
      if (!config.degradeOnTierMismatch) throw t
      callbacks.onError(
        AzureError(
          code = "INTERNAL_ERROR",
          message = "Diarization unavailable on this Azure tier — fell back to non-diarization recognition. (DEGRADED_MODE)",
        ),
      )
      AzureSpeechRecognizerEngineImpl(cfg, audio, this)
    }
  }

  suspend fun start() {
    if (released) throw AzureError("ENGINE_NOT_READY", "Session was released")
    val rec = engine ?: throw AzureError("ENGINE_NOT_READY", "Call prepare() first")

    accumulatedFinals.clear()
    latestPartial = ""
    sessionId = UUID.randomUUID().toString()
    sessionStartMs = System.currentTimeMillis().toDouble()
    tailWindowEndMs = 0L  // close any prior tail window — fresh session

    try {
      withContext(Dispatchers.IO) { rec.startAsync().get() }
    } catch (t: Throwable) {
      throw AzureErrorMapping.map(t)
    }

    active = true
    callbacks.onState("recording")
  }

  /**
   * Optimistic stop: returns immediately with the stitched session-final, then
   * keeps the recognizer alive for [TAIL_WINDOW_MS] so any tail Recognized
   * events Azure emits during its buffer flush surface as additional 'final'
   * callbacks.
   */
  suspend fun stop(): AzureTranscript {
    if (released) throw AzureError("ENGINE_NOT_READY", "Session was released")
    val rec = engine ?: throw AzureError("ENGINE_NOT_READY", "No active recognition")

    active = false
    tailWindowEndMs = System.currentTimeMillis() + TAIL_WINDOW_MS
    callbacks.onState("stopping")

    // Kick off the SDK stop — don't await. Tail events arrive on the listener
    // thread; sessionStopped lands a moment later and closes the window.
    runCatching {
      withContext(Dispatchers.IO) { rec.stopAsync() }
    }

    val optimisticFinal = buildSessionFinal()
    callbacks.onState("idle")
    return optimisticFinal
  }

  suspend fun discard() {
    active = false
    tailWindowEndMs = 0L
    val rec = engine
    if (rec != null) {
      runCatching {
        withContext(Dispatchers.IO) { rec.stopAsync() }
      }
    }
    callbacks.onState("idle")
  }

  /**
   * Hot-swap the auth token on the live recognizer. The SDK applies this on
   * the next websocket reconnect. Existing in-flight session is unaffected.
   * Delegates to the engine wrapper which knows which concrete subclass it
   * is and can reach its `properties` collection.
   */
  fun updateAuthToken(token: String) {
    speechConfig?.authorizationToken = token
    engine?.updateAuthToken(token)
  }

  suspend fun release() {
    if (released) return
    released = true
    discard()
    engine?.close()
    audioConfig?.close()
    speechConfig?.close()
    focusMonitor?.release()
    engine = null
    audioConfig = null
    speechConfig = null
    focusMonitor = null
    callbacks.onState("released")
  }

  /**
   * Request audio focus. Surface focus loss as a clean AUDIO_SESSION_INTERRUPTED
   * error instead of letting the session silently continue with no audio.
   */
  private fun installFocusMonitor() {
    if (focusMonitor != null) return
    val m = AudioFocusMonitor(
      context = context,
      onFocusLost = { transient ->
        if (!active) return@AudioFocusMonitor
        callbacks.onError(
          AzureError(
            code = "AUDIO_SESSION_INTERRUPTED",
            message = if (transient)
              "Audio focus lost transiently (another app, notification)."
            else
              "Audio focus permanently lost — recognition stopped.",
            recoverable = transient,
          ),
        )
      },
      onFocusRegained = { /* JS layer decides whether to retry */ },
    )
    m.acquire()
    focusMonitor = m
  }

  // MARK: Helpers

  /** True if we should still surface a result, based on session state + tail window. */
  private fun acceptingEvents(): Boolean {
    if (active) return true
    return System.currentTimeMillis() < tailWindowEndMs
  }

  private fun buildSessionFinal(): AzureTranscript = AzureTranscriptBuilder.fromText(
    text = accumulatedFinals.joinToString(" ").ifEmpty { latestPartial },
    isFinal = true,
    sessionId = sessionId,
    sessionStartMs = sessionStartMs,
    language = config.language,
  )

  // MARK: Setup

  private fun ensureMicPermission() {
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    if (!granted) {
      throw AzureError("PERMISSION_DENIED", "Microphone permission not granted")
    }
  }

  private fun validateAuthConfig() {
    val hasKey = config.subscriptionKey.isNotEmpty() && config.region.isNotEmpty()
    val hasToken = config.authToken.isNotEmpty() && config.region.isNotEmpty()
    val hasEndpoint = config.endpoint.isNotEmpty()
    if (!hasKey && !hasToken && !hasEndpoint) {
      throw AzureError(
        "INVALID_STATE",
        "Azure config needs one of: subscriptionKey+region, authToken+region, or endpoint.",
      )
    }
  }

  private fun buildSpeechConfig(): SpeechConfig {
    val cfg: SpeechConfig = when {
      config.endpoint.isNotEmpty() -> {
        val uri = URI.create(config.endpoint)
        if (config.subscriptionKey.isNotEmpty()) {
          SpeechConfig.fromEndpoint(uri, config.subscriptionKey)
        } else {
          SpeechConfig.fromEndpoint(uri)
        }.also { built ->
          if (config.authToken.isNotEmpty()) built.authorizationToken = config.authToken
        }
      }
      config.authToken.isNotEmpty() ->
        SpeechConfig.fromAuthorizationToken(config.authToken, config.region)
      else ->
        SpeechConfig.fromSubscription(config.subscriptionKey, config.region)
    }

    cfg.speechRecognitionLanguage = config.language

    val profanity = when (config.profanity.lowercase()) {
      "removed" -> ProfanityOption.Removed
      "raw", "none" -> ProfanityOption.Raw
      else -> ProfanityOption.Masked
    }
    cfg.setProfanity(profanity)

    if (config.outputFormat.lowercase() == "detailed") {
      cfg.outputFormat = OutputFormat.Detailed
      cfg.requestWordLevelTimestamps()
    }

    // Silence-detection: auto-stop after N ms of silence (server-side VAD).
    if (config.silenceTimeoutMs > 0) {
      cfg.setProperty(
        PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
        config.silenceTimeoutMs.toString(),
      )
    }

    return cfg
  }

  /**
   * Install phrase-list grammar on the live recognizer for custom-vocab biasing.
   * No-op if no hints were configured. Must be called AFTER the recognizer
   * exists.
   */
  private fun installPhraseHints() {
    if (config.phraseHints.isEmpty()) return
    val rec = engine?.sdkRecognizer ?: return
    val grammar = PhraseListGrammar.fromRecognizer(rec)
    for (phrase in config.phraseHints) {
      if (phrase.isNotEmpty()) grammar.addPhrase(phrase)
    }
  }

  // MARK: AzureRecognizerCallbacks

  override fun azureRecognizing(result: RecognitionResult, speakerId: String) {
    if (!active) return  // Don't emit partials in the tail window.
    val transcript = buildTranscript(result, isFinal = false, speakerId = speakerId)
    latestPartial = transcript.text
    if (config.emitPartials) {
      callbacks.onPartial(transcript)
    }
  }

  override fun azureRecognized(result: RecognitionResult, speakerId: String) {
    if (!acceptingEvents()) return
    if (result.reason != ResultReason.RecognizedSpeech) return
    val transcript = buildTranscript(result, isFinal = true, speakerId = speakerId)
    if (transcript.text.isNotEmpty()) {
      accumulatedFinals += transcript.text
    }
    callbacks.onFinal(transcript)
  }

  /** Shared builder call so partial + final paths don't duplicate the same 8-line invocation. */
  private fun buildTranscript(
    result: RecognitionResult,
    isFinal: Boolean,
    speakerId: String,
  ): AzureTranscript = AzureTranscriptBuilder.from(
    result = result,
    isFinal = isFinal,
    sessionId = sessionId,
    sessionStartMs = sessionStartMs,
    fallbackLanguage = config.language,
    speakerId = speakerId,
  )

  override fun azureCanceled(
    reason: CancellationReason?,
    errorCode: CancellationErrorCode?,
    errorDetails: String?,
  ) {
    if (reason == CancellationReason.EndOfStream) return
    if (!acceptingEvents()) return
    val mapped = AzureErrorMapping.map(
      reason = reason ?: CancellationReason.Error,
      errorCode = errorCode ?: CancellationErrorCode.NoError,
      errorDetails = errorDetails,
    )
    callbacks.onError(mapped)
  }

  override fun azureSessionStopped() {
    // Close the tail window — recognizer has finished flushing.
    tailWindowEndMs = 0L
  }

  override fun azureSpeechBoundary(kind: String, offsetMs: Double) {
    if (!active) return
    callbacks.onSpeechBoundary(kind, offsetMs)
  }
}
