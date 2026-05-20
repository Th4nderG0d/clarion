package com.clarionhq.recognizer

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * Drives `android.speech.SpeechRecognizer` and surfaces partials/finals/errors
 * to the bridge via [RecognizerCallbacks]. All SpeechRecognizer calls are
 * marshaled onto the main thread per the Android contract.
 */
internal class RecognizerSession(
  private val context: Context,
  private val config: RecognizerConfig,
  private val callbacks: RecognizerCallbacks,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null

  /** Set up before [stop] so the deferred resolves when SpeechRecognizer fires onResults/onError. */
  @Volatile private var stopDeferred: CompletableDeferred<RecognizerTranscript>? = null

  /** Last partial text — used to seed the final transcript when stop fires before onResults. */
  @Volatile private var latestPartial: String = ""

  @Volatile private var released: Boolean = false
  @Volatile private var active: Boolean = false

  /** Per-session identity. Re-generated on every [start]. */
  @Volatile private var ctx: TranscriptContext = TranscriptContext("", 0.0, config.language)

  private val lastAudioLevelEmitMs = AtomicLong(0L)

  fun prepare() {
    if (released) throw RecognizerError("ENGINE_NOT_READY", "Session was released")
    if (!hasRecordAudioPermission()) {
      throw RecognizerError(
        "PERMISSION_DENIED",
        "RECORD_AUDIO permission is required for speech recognition",
        recoverable = true,
      )
    }
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      throw RecognizerError(
        "ENGINE_NOT_READY",
        "No RecognitionService available on this device. Install Google or set a system speech provider.",
      )
    }
    runOnMainAwait {
      recognizer = createRecognizer().apply { setRecognitionListener(listener) }
    }
  }

  fun start() {
    if (released) throw RecognizerError("ENGINE_NOT_READY", "Session was released")
    val r = recognizer ?: throw RecognizerError("ENGINE_NOT_READY", "Call prepare() first")
    latestPartial = ""
    stopDeferred = null
    ctx = TranscriptContext(
      sessionId = UUID.randomUUID().toString(),
      sessionStartMs = System.currentTimeMillis().toDouble(),
      language = config.language,
    )

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, config.language)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, config.language)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, config.emitPartials)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, config.preferOnDevice)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
    }
    runOnMainAwait { r.startListening(intent) }
    active = true
    callbacks.onState("recording")
  }

  fun discard() {
    val r = recognizer ?: return
    active = false
    stopDeferred?.complete(TranscriptBuilder.fromText(latestPartial, true, ctx))
    stopDeferred = null
    runOnMainAwait { r.cancel() }
    callbacks.onState("idle")
  }

  suspend fun stop(): RecognizerTranscript {
    val r = recognizer ?: throw RecognizerError("ENGINE_NOT_READY", "No session")
    val deferred = CompletableDeferred<RecognizerTranscript>()
    stopDeferred = deferred

    runOnMainAwait { r.stopListening() }

    return try {
      withTimeout(RecognizerConstants.STOP_RESULT_TIMEOUT_MS) { deferred.await() }
    } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
      TranscriptBuilder.fromText(latestPartial, true, ctx)
    } finally {
      stopDeferred = null
      active = false
      callbacks.onState("idle")
    }
  }

  fun release() {
    if (released) return
    released = true
    active = false
    stopDeferred?.complete(TranscriptBuilder.fromText(latestPartial, true, ctx))
    stopDeferred = null
    val r = recognizer ?: return
    recognizer = null
    runOnMainAwait { r.destroy() }
  }

  private fun createRecognizer(): SpeechRecognizer {
    return if (
      config.preferOnDevice &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    ) {
      SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    } else {
      SpeechRecognizer.createSpeechRecognizer(context)
    }
  }

  private fun hasRecordAudioPermission(): Boolean =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    override fun onRmsChanged(rmsdB: Float) {
      if (!config.emitAudioLevel) return
      val now = System.currentTimeMillis()
      val last = lastAudioLevelEmitMs.get()
      if (now - last < config.audioLevelIntervalMs) return
      if (!lastAudioLevelEmitMs.compareAndSet(last, now)) return
      val normalized = ((rmsdB - RecognizerConstants.RMS_MIN) /
        (RecognizerConstants.RMS_MAX - RecognizerConstants.RMS_MIN))
        .coerceIn(0f, 1f).toDouble()
      callbacks.onAudioLevel(normalized, normalized)
    }

    override fun onError(error: Int) {
      // Drop tail callbacks fired after the session ended (e.g. ERROR_CLIENT
      // arriving after cancel() on Google's recognizer).
      if (!active && stopDeferred == null) return
      val mapped = mapAndroidSpeechError(error, config.language)
      val deferred = stopDeferred
      val isSilence = error == SpeechRecognizer.ERROR_NO_MATCH ||
        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT

      if (deferred != null) {
        // Resolve cleanly with what we have — throwing through the deferred
        // becomes a JNI exception that loses the error code. For silence,
        // suppress the error too (it's expected behavior).
        deferred.complete(TranscriptBuilder.fromText(latestPartial, true, ctx))
        stopDeferred = null
        if (!isSilence) callbacks.onError(mapped)
        return
      }
      // No stop() awaiting. Silence mid-recording → auto-stop quietly.
      if (isSilence) {
        callbacks.onFinal(TranscriptBuilder.fromText(latestPartial, true, ctx))
        callbacks.onState("idle")
        return
      }
      callbacks.onError(mapped)
    }

    override fun onResults(results: Bundle?) {
      val transcript = TranscriptBuilder.fromBundle(results, true, ctx)
      val deferred = stopDeferred
      if (deferred != null) {
        deferred.complete(transcript)
        stopDeferred = null
      } else {
        callbacks.onFinal(transcript)
        callbacks.onState("idle")
      }
    }

    override fun onPartialResults(partialResults: Bundle?) {
      if (!config.emitPartials) return
      val transcript = TranscriptBuilder.fromBundle(partialResults, false, ctx)
      if (transcript.text.isEmpty()) return
      latestPartial = transcript.text
      callbacks.onPartial(transcript)
    }
  }

  /**
   * Runs [block] on the main thread and waits for it to finish. Re-throws
   * any exception via the calling thread.
   */
  private fun runOnMainAwait(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block(); return
    }
    val latch = java.util.concurrent.CountDownLatch(1)
    val failure = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
    mainHandler.post {
      try { block() } catch (t: Throwable) { failure.set(t) } finally { latch.countDown() }
    }
    latch.await()
    failure.get()?.let { throw it }
  }
}
