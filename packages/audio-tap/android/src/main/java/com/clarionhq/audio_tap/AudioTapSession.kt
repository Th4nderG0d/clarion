package com.clarionhq.audio_tap

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/**
 * Owns the AudioRecord, the dedicated capture thread, and the carry buffer
 * that re-chunks AudioRecord reads into fixed-size frames at the requested
 * `frameDurationMs`.
 *
 * AudioRecord delivers at the requested sample rate natively — no resampler
 * is needed (unlike iOS where the hardware rate may differ).
 */
internal class AudioTapSession(
  private val context: Context,
  private val sampleRate: Int,
  private val channels: Int,
  private val bitsPerSample: Int,
  private val frameDurationMs: Int,
  private val callbacks: AudioTapCallbacks,
) {
  private val channelMask = if (channels == 1) {
    AudioFormat.CHANNEL_IN_MONO
  } else {
    AudioFormat.CHANNEL_IN_STEREO
  }
  private val encoding = AudioFormat.ENCODING_PCM_16BIT
  private val bytesPerSampleFrame = channels * (bitsPerSample / AudioTapConstants.BITS_PER_BYTE)
  private val bytesPerFrame =
    sampleRate * frameDurationMs / AudioTapConstants.MS_PER_SECOND * bytesPerSampleFrame

  private val minBufferBytes: Int by lazy {
    val min = AudioRecord.getMinBufferSize(sampleRate, channelMask, encoding)
    if (min <= 0) {
      throw AudioTapError(
        code = "UNSUPPORTED_FORMAT",
        message = "AudioRecord rejected format (sr=$sampleRate, ch=$channels, enc=$encoding).",
      )
    }
    val target = max(min, bytesPerFrame * AudioTapConstants.READ_BUFFER_FRAMES_MULTIPLIER)
    target + (target % bytesPerSampleFrame)
  }

  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  private var statsThread: Thread? = null
  private val running = AtomicBoolean(false)

  @Volatile private var framesEmitted: Long = 0
  @Volatile private var framesDropped: Long = 0
  @Volatile private var startedAtMs: Long = 0

  /** Bytes left over from the last AudioRecord read that didn't fill a frame. */
  private val carry = ByteArray(bytesPerFrame * 2)
  private var carrySize = 0
  private var frameIndex: Long = 0
  private val carryLock = Any()

  fun start() {
    requirePermission()

    val record = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.MIC)
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(sampleRate)
          .setChannelMask(channelMask)
          .setEncoding(encoding)
          .build(),
      )
      .setBufferSizeInBytes(minBufferBytes * 2)
      .build()

    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw AudioTapError(
        code = "AUDIO_BUSY",
        message = "AudioRecord failed to initialize — mic may be held by another app.",
        recoverable = true,
      )
    }

    audioRecord = record
    framesEmitted = 0
    framesDropped = 0
    frameIndex = 0
    synchronized(carryLock) { carrySize = 0 }

    record.startRecording()
    running.set(true)
    startedAtMs = System.currentTimeMillis()

    captureThread = Thread(::captureLoop, "ClarionAudioTap-Capture").apply {
      priority = Thread.MAX_PRIORITY - 1
      start()
    }
    statsThread = Thread(::statsLoop, "ClarionAudioTap-Stats").apply { start() }

    callbacks.onState("running")
  }

  fun stop() {
    if (!running.getAndSet(false)) return

    captureThread?.join(AudioTapConstants.CAPTURE_THREAD_JOIN_TIMEOUT_MS)
    captureThread = null
    statsThread?.join(AudioTapConstants.STATS_THREAD_JOIN_TIMEOUT_MS)
    statsThread = null

    runCatching { audioRecord?.stop() }
    audioRecord?.release()
    audioRecord = null

    synchronized(carryLock) { carrySize = 0 }
  }

  fun release() {
    stop()
    callbacks.onState("released")
  }

  fun isRunning(): Boolean = running.get()

  // MARK: - Capture loop

  private fun captureLoop() {
    val buffer = ByteArray(minBufferBytes)
    try {
      while (running.get()) {
        val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
        when {
          read > 0 -> emitFrames(buffer, read)
          read == AudioRecord.ERROR_INVALID_OPERATION ||
            read == AudioRecord.ERROR_BAD_VALUE ||
            read == AudioRecord.ERROR_DEAD_OBJECT ||
            read == AudioRecord.ERROR -> {
            throw AudioTapError(
              code = "INTERNAL_ERROR",
              message = "AudioRecord.read() returned $read.",
              recoverable = false,
            )
          }
        }
      }
    } catch (err: AudioTapError) {
      callbacks.onError(err)
    } catch (t: Throwable) {
      callbacks.onError(
        AudioTapError(
          code = "INTERNAL_ERROR",
          message = "Capture loop crashed: ${t.message ?: t.javaClass.simpleName}.",
          recoverable = false,
        ),
      )
    }
  }

  /**
   * Append AudioRecord's read bytes onto the carry buffer and drain as many
   * full frames as fit. `bytes[0..read)` is the new data; the carry preserves
   * any tail that didn't fill a frame on the previous call.
   */
  private fun emitFrames(bytes: ByteArray, read: Int) {
    var srcOffset = 0
    var srcRemaining = read

    synchronized(carryLock) {
      // First, fill any carry into a frame.
      if (carrySize > 0) {
        val needed = bytesPerFrame - carrySize
        val take = minOf(needed, srcRemaining)
        System.arraycopy(bytes, srcOffset, carry, carrySize, take)
        carrySize += take
        srcOffset += take
        srcRemaining -= take
        if (carrySize == bytesPerFrame) {
          dispatchFrame(carry.copyOf(bytesPerFrame))
          carrySize = 0
        }
      }

      // Then drain full frames straight from the input buffer.
      while (srcRemaining >= bytesPerFrame) {
        val frame = ByteArray(bytesPerFrame)
        System.arraycopy(bytes, srcOffset, frame, 0, bytesPerFrame)
        dispatchFrame(frame)
        srcOffset += bytesPerFrame
        srcRemaining -= bytesPerFrame
      }

      // Whatever's left becomes the new carry.
      if (srcRemaining > 0) {
        System.arraycopy(bytes, srcOffset, carry, 0, srcRemaining)
        carrySize = srcRemaining
      }
    }
  }

  private fun dispatchFrame(frame: ByteArray) {
    val timestamp = frameDurationMs.toDouble() * frameIndex.toDouble()
    callbacks.onFrame(
      pcm = frame,
      timestamp = timestamp,
      frameIndex = frameIndex,
      sampleRate = sampleRate,
      channels = channels,
      bitsPerSample = bitsPerSample,
    )
    frameIndex++
    framesEmitted++
  }

  // MARK: - Stats

  private fun statsLoop() {
    while (running.get()) {
      try {
        Thread.sleep(AudioTapConstants.STATS_INTERVAL_MS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        return
      }
      if (!running.get()) return
      callbacks.onStats(
        uptimeMs = (System.currentTimeMillis() - startedAtMs).toDouble(),
        framesEmitted = framesEmitted,
        framesDropped = framesDropped,
        bufferFillPct = 0.0,  // v1: synchronous drain, no ring.
      )
    }
  }

  // MARK: - Permission

  private fun requirePermission() {
    val granted = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
    if (!granted) {
      throw AudioTapError(
        code = "PERMISSION_DENIED",
        message = "RECORD_AUDIO permission not granted.",
        recoverable = false,
      )
    }
  }

}
