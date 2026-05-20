package com.margelo.nitro.clarion.recognizer

import android.content.Context
import com.clarionhq.recognizer.RecognizerCallbacks
import com.clarionhq.recognizer.RecognizerConfig
import com.clarionhq.recognizer.RecognizerError
import com.clarionhq.recognizer.RecognizerSegment
import com.clarionhq.recognizer.RecognizerSession
import com.clarionhq.recognizer.RecognizerSupport
import com.clarionhq.recognizer.RecognizerTranscript
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.concurrent.atomic.AtomicInteger

@DoNotStrip
class HybridClarionRecognizer : HybridClarionRecognizerSpec() {
  override val memorySize: Long get() = 0L

  private val context: Context = NitroModules.applicationContext
    ?: error("Nitro applicationContext is null — was the module initialized?")

  private val nextListenerId = AtomicInteger(1)
  private val stateListeners = mutableMapOf<Int, (String) -> Unit>()
  private val audioLevelListeners = mutableMapOf<Int, (Double, Double) -> Unit>()
  private val partialListeners = mutableMapOf<Int, (NativeTranscriptResult) -> Unit>()
  private val finalListeners = mutableMapOf<Int, (NativeTranscriptResult) -> Unit>()
  private val errorListeners = mutableMapOf<Int, (NativeRecognizerError) -> Unit>()

  @Volatile private var session: RecognizerSession? = null
  @Volatile private var currentState: String = "idle"

  private val callbacks = object : RecognizerCallbacks {
    override fun onState(state: String) {
      currentState = state
      stateListeners.values.toList().forEach { runCatching { it(state) } }
    }

    override fun onAudioLevel(rms: Double, peak: Double) {
      audioLevelListeners.values.toList().forEach { runCatching { it(rms, peak) } }
    }

    override fun onPartial(transcript: RecognizerTranscript) {
      val payload = transcript.toNative()
      partialListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onFinal(transcript: RecognizerTranscript) {
      val payload = transcript.toNative()
      finalListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onError(error: RecognizerError) {
      currentState = "error"
      val payload = NativeRecognizerError(
        code = error.code,
        message = error.message ?: "Unknown recognizer error",
        recoverable = error.recoverable,
      )
      errorListeners.values.toList().forEach { runCatching { it(payload) } }
    }
  }

  override val state: String get() = currentState

  override fun isAvailable(language: String): Promise<Boolean> = Promise.async {
    RecognizerSupport.isLocaleAvailable(context, language)
  }

  override fun supportedLocales(): Promise<Array<String>> = Promise.async {
    RecognizerSupport.querySupportedLocales(context).toTypedArray()
  }

  override fun prepare(config: NativeRecognizerConfig): Promise<Unit> = Promise.async {
    runOrThrow {
      val parsed = config.toKotlinConfig()
      val newSession = RecognizerSession(context, parsed, callbacks)
      callbacks.onState("preparing")
      newSession.prepare()
      session = newSession
      callbacks.onState("ready")
    }
  }

  override fun start(): Promise<Unit> = Promise.async {
    runOrThrow {
      val s = session ?: throw RecognizerError("ENGINE_NOT_READY", "Call prepare() first")
      callbacks.onState("starting")
      s.start()
    }
  }

  override fun stop(): Promise<NativeTranscriptResult> = Promise.async {
    runOrThrow {
      val s = session ?: throw RecognizerError("ENGINE_NOT_READY", "No session")
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

  private inline fun <T> runOrThrow(block: () -> T): T {
    return try {
      block()
    } catch (e: RecognizerError) {
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

  override fun addErrorListener(listener: (NativeRecognizerError) -> Unit): Double =
    register(errorListeners, listener)

  override fun removeListener(id: Double) {
    val key = id.toInt()
    stateListeners.remove(key)
    audioLevelListeners.remove(key)
    partialListeners.remove(key)
    finalListeners.remove(key)
    errorListeners.remove(key)
  }

  override fun removeAllListeners() {
    stateListeners.clear()
    audioLevelListeners.clear()
    partialListeners.clear()
    finalListeners.clear()
    errorListeners.clear()
  }

  private fun <T> register(map: MutableMap<Int, T>, listener: T): Double {
    val id = nextListenerId.getAndIncrement()
    map[id] = listener
    return id.toDouble()
  }
}

private fun NativeRecognizerConfig.toKotlinConfig(): RecognizerConfig = RecognizerConfig(
  language = language,
  emitPartials = emitPartials,
  emitAudioLevel = emitAudioLevel,
  audioLevelIntervalMs = audioLevelIntervalMs.toInt(),
  preferOnDevice = preferOnDevice,
)

private fun RecognizerSegment.toNative(): NativeTranscriptSegment = NativeTranscriptSegment(
  text = text,
  startMs = startMs,
  durationMs = durationMs,
  confidence = confidence,
  alternatives = alternatives.toTypedArray(),
)

private fun RecognizerTranscript.toNative(): NativeTranscriptResult = NativeTranscriptResult(
  id = id,
  sessionId = sessionId,
  timestamp = timestamp,
  text = text,
  isFinal = isFinal,
  language = language,
  confidence = confidence,
  offsetMs = offsetMs,
  durationMs = durationMs,
  segments = segments.map { it.toNative() }.toTypedArray(),
)
