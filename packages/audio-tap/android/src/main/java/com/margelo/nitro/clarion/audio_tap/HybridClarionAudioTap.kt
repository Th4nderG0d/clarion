package com.margelo.nitro.clarion.audio_tap

import android.content.Context
import com.clarionhq.audio_tap.AudioTapCallbacks
import com.clarionhq.audio_tap.AudioTapError
import com.clarionhq.audio_tap.AudioTapSession
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.util.concurrent.atomic.AtomicInteger

@DoNotStrip
class HybridClarionAudioTap : HybridClarionAudioTapSpec() {
  override val memorySize: Long get() = 0L

  private val context: Context = NitroModules.applicationContext
    ?: error("Nitro applicationContext is null — was the module initialized?")

  private val nextListenerId = AtomicInteger(1)
  private val frameListeners = mutableMapOf<Int, (NativeAudioTapFrame) -> Unit>()
  private val stateListeners = mutableMapOf<Int, (String) -> Unit>()
  private val statsListeners = mutableMapOf<Int, (NativeAudioTapStats) -> Unit>()
  private val errorListeners = mutableMapOf<Int, (NativeAudioTapError) -> Unit>()

  @Volatile private var session: AudioTapSession? = null
  @Volatile private var currentStateValue: String = "idle"

  private val callbacks = object : AudioTapCallbacks {
    override fun onState(state: String) {
      currentStateValue = state
      stateListeners.values.toList().forEach { runCatching { it(state) } }
    }

    override fun onFrame(
      pcm: ByteArray,
      timestamp: Double,
      frameIndex: Long,
      sampleRate: Int,
      channels: Int,
      bitsPerSample: Int,
    ) {
      val buffer = ArrayBuffer.copy(pcm)
      val frame = NativeAudioTapFrame(
        pcm = buffer,
        timestamp = timestamp,
        frameIndex = frameIndex.toDouble(),
        sampleRate = sampleRate.toDouble(),
        channels = channels.toDouble(),
        bitsPerSample = bitsPerSample.toDouble(),
      )
      frameListeners.values.toList().forEach { runCatching { it(frame) } }
    }

    override fun onStats(
      uptimeMs: Double,
      framesEmitted: Long,
      framesDropped: Long,
      bufferFillPct: Double,
    ) {
      val payload = NativeAudioTapStats(
        uptimeMs = uptimeMs,
        framesEmitted = framesEmitted.toDouble(),
        framesDropped = framesDropped.toDouble(),
        listenerCount = frameListeners.size.toDouble(),
        bufferFillPct = bufferFillPct,
      )
      statsListeners.values.toList().forEach { runCatching { it(payload) } }
    }

    override fun onError(error: AudioTapError) {
      val payload = NativeAudioTapError(
        code = error.code,
        message = error.message,
        recoverable = error.recoverable,
      )
      errorListeners.values.toList().forEach { runCatching { it(payload) } }
    }
  }

  override val state: String get() = currentStateValue
  override val listenerCount: Double get() = frameListeners.size.toDouble()

  override fun start(format: NativeAudioTapFormat): Promise<Unit> {
    return Promise.async {
      val existing = session
      if (existing != null && existing.isRunning()) return@async

      currentStateValue = "starting"
      stateListeners.values.toList().forEach { runCatching { it("starting") } }

      try {
        val newSession = AudioTapSession(
          context = context,
          sampleRate = format.sampleRate.toInt(),
          channels = format.channels.toInt(),
          bitsPerSample = format.bitsPerSample.toInt(),
          frameDurationMs = format.frameDurationMs.toInt(),
          callbacks = callbacks,
        )
        newSession.start()
        session = newSession
      } catch (err: AudioTapError) {
        session = null
        currentStateValue = "idle"
        stateListeners.values.toList().forEach { runCatching { it("idle") } }
        callbacks.onError(err)
        throw err
      } catch (t: Throwable) {
        session = null
        currentStateValue = "idle"
        stateListeners.values.toList().forEach { runCatching { it("idle") } }
        val wrapped = AudioTapError(
          code = "INTERNAL_ERROR",
          message = t.message ?: t.javaClass.simpleName,
          recoverable = false,
        )
        callbacks.onError(wrapped)
        throw wrapped
      }
    }
  }

  override fun stop(): Promise<Unit> {
    return Promise.async {
      val s = session ?: return@async
      currentStateValue = "stopping"
      stateListeners.values.toList().forEach { runCatching { it("stopping") } }
      runCatching { s.stop() }
      session = null
      currentStateValue = "idle"
      stateListeners.values.toList().forEach { runCatching { it("idle") } }
    }
  }

  override fun release(): Promise<Unit> {
    return Promise.async {
      session?.let { runCatching { it.release() } }
      session = null
      removeAllListeners()
      currentStateValue = "released"
    }
  }

  override fun addFrameListener(listener: (NativeAudioTapFrame) -> Unit): Double {
    val id = nextListenerId.getAndIncrement()
    frameListeners[id] = listener
    return id.toDouble()
  }

  override fun addStateListener(listener: (String) -> Unit): Double {
    val id = nextListenerId.getAndIncrement()
    stateListeners[id] = listener
    return id.toDouble()
  }

  override fun addStatsListener(listener: (NativeAudioTapStats) -> Unit): Double {
    val id = nextListenerId.getAndIncrement()
    statsListeners[id] = listener
    return id.toDouble()
  }

  override fun addErrorListener(listener: (NativeAudioTapError) -> Unit): Double {
    val id = nextListenerId.getAndIncrement()
    errorListeners[id] = listener
    return id.toDouble()
  }

  override fun removeListener(id: Double) {
    val key = id.toInt()
    frameListeners.remove(key)
    stateListeners.remove(key)
    statsListeners.remove(key)
    errorListeners.remove(key)
  }

  override fun removeAllListeners() {
    frameListeners.clear()
    stateListeners.clear()
    statsListeners.clear()
    errorListeners.clear()
  }
}
