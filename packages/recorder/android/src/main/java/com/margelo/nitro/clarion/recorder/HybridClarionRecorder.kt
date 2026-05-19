package com.margelo.nitro.clarion.recorder

import android.content.Context
import com.clarionhq.recorder.RecorderCallbacks
import com.clarionhq.recorder.RecorderConfig
import com.clarionhq.recorder.RecorderError
import com.clarionhq.recorder.RecorderResult
import com.clarionhq.recorder.RecorderSession
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.concurrent.atomic.AtomicInteger

@DoNotStrip
class HybridClarionRecorder : HybridClarionRecorderSpec() {
  override val memorySize: Long get() = 0L

  private val context: Context = NitroModules.applicationContext
    ?: error("Nitro applicationContext is null — was the module initialized?")

  private val nextListenerId = AtomicInteger(1)
  private val stateListeners = mutableMapOf<Int, (String) -> Unit>()
  private val audioLevelListeners = mutableMapOf<Int, (Double, Double) -> Unit>()
  private val chunkListeners = mutableMapOf<Int, (String, Double, Double, Double) -> Unit>()
  private val errorListeners = mutableMapOf<Int, (NativeRecorderError) -> Unit>()

  @Volatile private var session: RecorderSession? = null
  @Volatile private var currentState: String = "idle"

  private val callbacks = object : RecorderCallbacks {
    override fun onState(state: String) {
      currentState = state
      stateListeners.values.toList().forEach { runCatching { it(state) } }
    }
    override fun onAudioLevel(rms: Double, peak: Double) {
      audioLevelListeners.values.toList().forEach { runCatching { it(rms, peak) } }
    }
    override fun onChunk(uri: String, startMs: Long, endMs: Long, sizeBytes: Long) {
      chunkListeners.values.toList().forEach {
        runCatching { it(uri, startMs.toDouble(), endMs.toDouble(), sizeBytes.toDouble()) }
      }
    }
    override fun onError(error: RecorderError) {
      currentState = "error"
      val payload = NativeRecorderError(
        code = error.code,
        message = error.message ?: "Unknown error",
        recoverable = error.recoverable,
      )
      errorListeners.values.toList().forEach { runCatching { it(payload) } }
    }
  }

  override val state: String get() = currentState

  override fun prepare(config: NativeRecorderConfig): Promise<Unit> =
    Promise.async {
      runOrThrow {
        val parsed = config.toKotlinConfig()
        val newSession = RecorderSession(context, parsed, callbacks)
        callbacks.onState("preparing")
        newSession.prepare()
        session = newSession
        callbacks.onState("ready")
      }
    }

  override fun start(): Promise<Unit> = Promise.async {
    runOrThrow {
      val s = session ?: throw RecorderError("ENGINE_NOT_READY", "Call prepare() first")
      callbacks.onState("starting")
      s.start()
    }
  }

  override fun pause(): Promise<Unit> = Promise.async {
    runOrThrow {
      session?.pause() ?: throw RecorderError("ENGINE_NOT_READY", "No session")
    }
  }

  override fun resume(): Promise<Unit> = Promise.async {
    runOrThrow {
      session?.resume() ?: throw RecorderError("ENGINE_NOT_READY", "No session")
    }
  }

  override fun stop(): Promise<NativeRecorderResult> = Promise.async {
    runOrThrow {
      val s = session ?: throw RecorderError("ENGINE_NOT_READY", "No session")
      val result = s.stop().toNative()
      session = null
      result
    }
  }

  override fun discard(): Promise<Unit> = Promise.async {
    runOrThrow {
      session?.discard()
      session = null
    }
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
    } catch (e: RecorderError) {
      throw RuntimeException("[${e.code}] ${e.message}", e)
    }
  }

  override fun addStateListener(listener: (String) -> Unit): Double =
    register(stateListeners, listener)

  override fun addAudioLevelListener(listener: (Double, Double) -> Unit): Double =
    register(audioLevelListeners, listener)

  override fun addChunkListener(
    listener: (String, Double, Double, Double) -> Unit,
  ): Double = register(chunkListeners, listener)

  override fun addErrorListener(listener: (NativeRecorderError) -> Unit): Double =
    register(errorListeners, listener)

  override fun removeListener(id: Double) {
    val key = id.toInt()
    stateListeners.remove(key)
    audioLevelListeners.remove(key)
    chunkListeners.remove(key)
    errorListeners.remove(key)
  }

  override fun removeAllListeners() {
    stateListeners.clear()
    audioLevelListeners.clear()
    chunkListeners.clear()
    errorListeners.clear()
  }

  private fun <T> register(map: MutableMap<Int, T>, listener: T): Double {
    val id = nextListenerId.getAndIncrement()
    map[id] = listener
    return id.toDouble()
  }
}

private fun NativeRecorderConfig.toKotlinConfig(): RecorderConfig = RecorderConfig(
  sampleRate = sampleRate.toInt(),
  channels = channels.toInt(),
  bitDepth = bitDepth.toInt(),
  outputDirectory = outputDirectory,
  filenamePrefix = filenamePrefix,
  rotateAfterMs = rotateAfterMs?.toLong(),
  emitAudioLevel = emitAudioLevel,
  audioLevelIntervalMs = audioLevelIntervalMs.toInt(),
  aacBitrate = aacBitrate.toInt(),
)

private fun RecorderResult.toNative(): NativeRecorderResult = NativeRecorderResult(
  uri = uri,
  durationMs = durationMs.toDouble(),
  sizeBytes = sizeBytes.toDouble(),
  sampleRate = sampleRate.toDouble(),
  channels = channels.toDouble(),
  bitDepth = bitDepth.toDouble(),
)
