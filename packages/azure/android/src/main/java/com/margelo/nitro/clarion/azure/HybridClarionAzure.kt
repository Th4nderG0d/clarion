package com.margelo.nitro.clarion.azure

import android.content.Context
import com.clarionhq.azure.AzureCallbacks
import com.clarionhq.azure.AzureConfig
import com.clarionhq.azure.AzureError
import com.clarionhq.azure.AzureSegment
import com.clarionhq.azure.AzureSession
import com.clarionhq.azure.AzureTranscript
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.microsoft.cognitiveservices.speech.SpeechConfig
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger

@DoNotStrip
class HybridClarionAzure : HybridClarionAzureSpec() {
  override val memorySize: Long get() = 0L

  private val context: Context = NitroModules.applicationContext
    ?: error("Nitro applicationContext is null — was the module initialized?")

  private val nextListenerId = AtomicInteger(1)
  private val stateListeners = mutableMapOf<Int, (String) -> Unit>()
  private val audioLevelListeners = mutableMapOf<Int, (Double, Double) -> Unit>()
  private val partialListeners = mutableMapOf<Int, (NativeTranscriptResult) -> Unit>()
  private val finalListeners = mutableMapOf<Int, (NativeTranscriptResult) -> Unit>()
  private val errorListeners = mutableMapOf<Int, (NativeAzureError) -> Unit>()
  private val speechBoundaryListeners = mutableMapOf<Int, (String, Double) -> Unit>()

  @Volatile private var session: AzureSession? = null
  @Volatile private var currentState: String = "idle"

  private val callbacks = object : AzureCallbacks {
    override fun onState(state: String) {
      currentState = state
      stateListeners.values.toList().forEach { runCatching { it(state) } }
    }

    override fun onAudioLevel(rms: Double, peak: Double) {
      audioLevelListeners.values.toList().forEach { runCatching { it(rms, peak) } }
    }

    override fun onPartial(transcript: AzureTranscript) {
      val payload = transcript.toNative()
      partialListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onFinal(transcript: AzureTranscript) {
      val payload = transcript.toNative()
      finalListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onError(error: AzureError) {
      currentState = "error"
      val payload = NativeAzureError(
        code = error.code,
        message = error.message ?: "Unknown Azure error",
        recoverable = error.recoverable,
      )
      errorListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onSpeechBoundary(kind: String, offsetMs: Double) {
      speechBoundaryListeners.values.toList().forEach { runCatching { it(kind, offsetMs) } }
    }
  }

  override val state: String get() = currentState

  override fun isAvailable(config: NativeAzureConfig): Promise<Boolean> = Promise.async {
    runCatching {
      val parsed = config.toKotlinConfig()
      val hasKey = parsed.subscriptionKey.isNotEmpty() && parsed.region.isNotEmpty()
      val hasToken = parsed.authToken.isNotEmpty() && parsed.region.isNotEmpty()
      val hasEndpoint = parsed.endpoint.isNotEmpty()
      if (!hasKey && !hasToken && !hasEndpoint) return@runCatching false

      // Best-effort probe: try to build a SpeechConfig with the supplied auth.
      // Real auth failures only surface at start() against the service.
      val cfg = when {
        hasEndpoint -> SpeechConfig.fromEndpoint(URI.create(parsed.endpoint))
        hasToken -> SpeechConfig.fromAuthorizationToken(parsed.authToken, parsed.region)
        else -> SpeechConfig.fromSubscription(parsed.subscriptionKey, parsed.region)
      }
      cfg.close()
      true
    }.getOrDefault(false)
  }

  override fun prepare(config: NativeAzureConfig): Promise<Unit> = Promise.async {
    runOrThrow {
      val parsed = config.toKotlinConfig()
      val newSession = AzureSession(context, parsed, callbacks)
      callbacks.onState("preparing")
      newSession.prepare()
      session = newSession
      callbacks.onState("ready")
    }
  }

  override fun start(): Promise<Unit> = Promise.async {
    runOrThrow {
      val s = session ?: throw AzureError("ENGINE_NOT_READY", "Call prepare() first")
      callbacks.onState("starting")
      s.start()
    }
  }

  override fun stop(): Promise<NativeTranscriptResult> = Promise.async {
    runOrThrow {
      val s = session ?: throw AzureError("ENGINE_NOT_READY", "No session")
      callbacks.onState("stopping")
      s.stop().toNative()
    }
  }

  override fun discard(): Promise<Unit> = Promise.async {
    runOrThrow { session?.discard() }
  }

  override fun release(): Promise<Unit> = Promise.async {
    runOrThrow {
      session?.release()
      session = null
      removeAllListeners()
    }
  }

  override fun updateAuthToken(token: String): Promise<Unit> = Promise.async {
    runOrThrow {
      // Forward to the active session if one exists; otherwise no-op.
      // The next prepare() will pick up the new token from config.
      session?.updateAuthToken(token)
    }
  }

  private inline fun <T> runOrThrow(block: () -> T): T {
    return try {
      block()
    } catch (e: AzureError) {
      throw RuntimeException("[${e.code}] ${e.message}", e)
    }
  }

  override fun addStateListener(listener: (String) -> Unit): Double =
    register(stateListeners, listener)

  override fun addAudioLevelListener(listener: (Double, Double) -> Unit): Double =
    register(audioLevelListeners, listener)

  override fun addPartialListener(listener: (NativeTranscriptResult) -> Unit): Double =
    register(partialListeners, listener)

  override fun addFinalListener(listener: (NativeTranscriptResult) -> Unit): Double =
    register(finalListeners, listener)

  override fun addErrorListener(listener: (NativeAzureError) -> Unit): Double =
    register(errorListeners, listener)

  override fun addSpeechBoundaryListener(listener: (String, Double) -> Unit): Double =
    register(speechBoundaryListeners, listener)

  override fun removeListener(id: Double) {
    val key = id.toInt()
    stateListeners.remove(key)
    audioLevelListeners.remove(key)
    partialListeners.remove(key)
    finalListeners.remove(key)
    errorListeners.remove(key)
    speechBoundaryListeners.remove(key)
  }

  override fun removeAllListeners() {
    stateListeners.clear()
    audioLevelListeners.clear()
    partialListeners.clear()
    finalListeners.clear()
    errorListeners.clear()
    speechBoundaryListeners.clear()
  }

  private fun <T> register(map: MutableMap<Int, T>, listener: T): Double {
    val id = nextListenerId.getAndIncrement()
    map[id] = listener
    return id.toDouble()
  }
}

private fun NativeAzureConfig.toKotlinConfig(): AzureConfig {
  val langs = if (autoDetectLanguages.isEmpty()) {
    emptyList()
  } else {
    autoDetectLanguages.split(",")
      .map { it.trim() }
      .filter { it.isNotEmpty() }
  }
  // Phrase hints are newline-separated — phrases can legitimately contain commas.
  val phrases = if (phraseHints.isEmpty()) {
    emptyList()
  } else {
    phraseHints.split("\n")
      .map { it.trim() }
      .filter { it.isNotEmpty() }
  }
  return AzureConfig(
    language = language,
    emitPartials = emitPartials,
    emitAudioLevel = emitAudioLevel,
    audioLevelIntervalMs = audioLevelIntervalMs.toInt(),
    subscriptionKey = subscriptionKey,
    region = region,
    authToken = authToken,
    endpoint = endpoint,
    outputFormat = outputFormat,
    profanity = profanity,
    enableSpeakerDiarization = enableSpeakerDiarization,
    autoDetectLanguages = langs,
    silenceTimeoutMs = silenceTimeoutMs.toLong(),
    phraseHints = phrases,
    degradeOnTierMismatch = degradeOnTierMismatch,
  )
}

private fun AzureSegment.toNative(): NativeTranscriptSegment = NativeTranscriptSegment(
  text = text,
  startMs = startMs,
  durationMs = durationMs,
  confidence = confidence,
  alternatives = alternatives.toTypedArray(),
)

private fun AzureTranscript.toNative(): NativeTranscriptResult = NativeTranscriptResult(
  id = id,
  sessionId = sessionId,
  timestamp = timestamp,
  text = text,
  isFinal = isFinal,
  language = language,
  confidence = confidence,
  offsetMs = offsetMs,
  durationMs = durationMs,
  speakerId = speakerId,
  segments = segments.map { it.toNative() }.toTypedArray(),
)
