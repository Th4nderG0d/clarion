package com.clarionhq.recorder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

internal class RecorderSession(
  private val context: Context,
  private val config: RecorderConfig,
  private val callbacks: RecorderCallbacks,
) {
  private val channelMask = if (config.channels == 1) {
    AudioFormat.CHANNEL_IN_MONO
  } else {
    AudioFormat.CHANNEL_IN_STEREO
  }

  private val encoding = AudioFormat.ENCODING_PCM_16BIT
  private val bytesPerFrame = config.channels * 2
  private val bytesPerSecond = config.sampleRate * bytesPerFrame

  private val minBufferBytes by lazy {
    val min = AudioRecord.getMinBufferSize(config.sampleRate, channelMask, encoding)
    if (min <= 0) throw RecorderError("UNSUPPORTED_FORMAT", "AudioRecord rejected format")
    val target = max(min, bytesPerSecond / RecorderConstants.CAPTURE_BUFFER_FRACTION_OF_SECOND)
    target + (target % bytesPerFrame)
  }

  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  private var encodeThread: Thread? = null

  private val running = AtomicBoolean(false)
  private val paused = AtomicBoolean(false)

  private val pcmQueue = LinkedBlockingQueue<PcmChunk>(RecorderConstants.PCM_QUEUE_CAPACITY)

  @Volatile private var sessionStartMs = 0L
  @Volatile private var currentFilePath: String? = null
  @Volatile private var totalBytesWritten = 0L
  @Volatile private var lastLevelEmitMs = 0L

  /** Watches audio focus changes so we can surface clean INTERRUPTED errors. */
  private var focusMonitor: AudioFocusMonitor? = null

  private data class PcmChunk(val bytes: ByteArray, val isEos: Boolean)

  fun prepare() {
    requirePermission()
    installFocusMonitor()
    audioRecord = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.MIC)
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(config.sampleRate)
          .setChannelMask(channelMask)
          .setEncoding(encoding)
          .build(),
      )
      .setBufferSizeInBytes(minBufferBytes * 2)
      .build()
      .also {
        if (it.state != AudioRecord.STATE_INITIALIZED) {
          it.release()
          throw RecorderError("ENGINE_NOT_READY", "AudioRecord failed to initialize")
        }
      }
  }

  fun start() {
    val record = audioRecord ?: throw RecorderError("ENGINE_NOT_READY", "Call prepare() first")
    RecorderStorageGuard.ensureSufficientStorage(resolveOutputDir())
    sessionStartMs = System.currentTimeMillis()
    totalBytesWritten = 0L
    pcmQueue.clear()

    record.startRecording()
    running.set(true)
    paused.set(false)

    captureThread = Thread(::captureLoop, "Clarion-Capture").apply { start() }
    encodeThread = Thread(::encodeLoop, "Clarion-Encode").apply { start() }

    callbacks.onState("recording")
  }

  fun pause() {
    if (!running.get()) throw RecorderError("INVALID_STATE", "Not recording")
    paused.set(true)
    callbacks.onState("paused")
  }

  fun resume() {
    if (!running.get()) throw RecorderError("INVALID_STATE", "Not recording")
    paused.set(false)
    callbacks.onState("recording")
  }

  fun stop(): RecorderResult {
    if (!running.get()) throw RecorderError("INVALID_STATE", "Not recording")
    callbacks.onState("stopping")

    running.set(false)
    pcmQueue.offer(PcmChunk(ByteArray(0), isEos = true))

    encodeThread?.join(RecorderConstants.ENCODE_THREAD_JOIN_TIMEOUT_MS)
    captureThread?.join(RecorderConstants.CAPTURE_THREAD_JOIN_TIMEOUT_MS)

    runCatching { audioRecord?.stop() }
    audioRecord?.release()
    audioRecord = null

    val finalUri = currentFilePath?.let { "${RecorderConstants.URI_SCHEME}$it" }
      ?: throw RecorderError("INTERNAL_ERROR", "No output file produced")

    val durationMs = System.currentTimeMillis() - sessionStartMs
    callbacks.onState("idle")

    return RecorderResult(
      uri = finalUri,
      durationMs = durationMs,
      sizeBytes = totalBytesWritten,
      sampleRate = config.sampleRate,
      channels = config.channels,
      bitDepth = config.bitDepth,
    )
  }

  fun discard() {
    val wasRecording = running.getAndSet(false)
    pcmQueue.offer(PcmChunk(ByteArray(0), isEos = true))
    encodeThread?.join(RecorderConstants.CANCEL_ENCODE_JOIN_TIMEOUT_MS)
    captureThread?.join(RecorderConstants.CANCEL_CAPTURE_JOIN_TIMEOUT_MS)
    runCatching { audioRecord?.stop() }
    audioRecord?.release()
    audioRecord = null

    if (wasRecording) {
      // Only delete in-progress recordings; never delete a finalized file.
      currentFilePath?.let { runCatching { File(it).delete() } }
    }
    currentFilePath = null
    callbacks.onState("idle")
  }

  fun release() {
    if (running.get()) discard()
    audioRecord?.release()
    audioRecord = null
    focusMonitor?.release()
    focusMonitor = null
    callbacks.onState("released")
  }

  /**
   * Acquire audio focus + surface losses as clean AUDIO_SESSION_INTERRUPTED.
   * A permanent loss stops capture; transient losses (notification, brief
   * ducking) leave the JS layer to decide whether to keep recording.
   */
  private fun installFocusMonitor() {
    if (focusMonitor != null) return
    val m = AudioFocusMonitor(
      context = context,
      onFocusLost = { transient ->
        if (!running.get()) return@AudioFocusMonitor
        callbacks.onError(
          RecorderError(
            code = "AUDIO_SESSION_INTERRUPTED",
            message = if (transient)
              "Audio focus lost transiently (another app, notification)."
            else
              "Audio focus permanently lost — recording stopped.",
            recoverable = transient,
          ),
        )
      },
      onFocusRegained = { /* JS layer decides whether to resume */ },
    )
    m.acquire()
    focusMonitor = m
  }

  private fun captureLoop() {
    val buffer = ByteArray(minBufferBytes)
    callbacks.runCatchingRecorder("IO_ERROR", "Capture failed") {
      while (running.get()) {
        val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
        when {
          read > 0 -> {
            if (!paused.get()) {
              if (config.emitAudioLevel) maybeEmitLevels(buffer, read)
              pcmQueue.put(PcmChunk(buffer.copyOf(read), isEos = false))
            }
          }
          read == AudioRecord.ERROR_INVALID_OPERATION ||
          read == AudioRecord.ERROR_BAD_VALUE ||
          read == AudioRecord.ERROR_DEAD_OBJECT ||
          read == AudioRecord.ERROR -> {
            throw RecorderError("IO_ERROR", "AudioRecord.read() returned $read")
          }
        }
      }
    }
  }

  private fun encodeLoop() {
    var session: EncodeFile? = null
    var presentationUs = 0L
    var fileStartedAtMs = System.currentTimeMillis()

    callbacks.runCatchingRecorder("INTERNAL_ERROR", "Encode failed") {
      session = openEncodeFile().also { currentFilePath = it.path }
      val rotateMs = config.rotateAfterMs

      while (true) {
        val chunk = pcmQueue.poll(
          RecorderConstants.PCM_QUEUE_POLL_TIMEOUT_MS,
          TimeUnit.MILLISECONDS,
        ) ?: continue

        val activeSession = session ?: break
        val rotateNow = !chunk.isEos && rotateMs != null &&
          (System.currentTimeMillis() - fileStartedAtMs) >= rotateMs

        if (chunk.isEos || rotateNow) {
          drainAndFinalize(activeSession, presentationUs, isEos = true)
          emitChunkComplete(activeSession, fileStartedAtMs)
          activeSession.close()

          if (chunk.isEos) {
            currentFilePath = activeSession.path
            break
          }

          presentationUs = 0L
          fileStartedAtMs = System.currentTimeMillis()
          session = openEncodeFile().also { currentFilePath = it.path }
          if (chunk.bytes.isNotEmpty()) {
            presentationUs = feedPcm(session!!, chunk.bytes, presentationUs)
          }
        } else {
          presentationUs = feedPcm(activeSession, chunk.bytes, presentationUs)
          drainEncoder(activeSession, endOfStream = false)
        }
      }
    }
    session?.runCatching { close() }
  }

  private fun feedPcm(session: EncodeFile, pcm: ByteArray, basePtsUs: Long): Long {
    val inIndex = session.codec.dequeueInputBuffer(RecorderConstants.CODEC_DEQUEUE_TIMEOUT_US)
    if (inIndex < 0) return basePtsUs

    val inBuf: ByteBuffer = session.codec.getInputBuffer(inIndex)
      ?: throw RecorderError("INTERNAL_ERROR", "Null input buffer")
    inBuf.clear()
    inBuf.put(pcm)
    session.codec.queueInputBuffer(inIndex, 0, pcm.size, basePtsUs, 0)

    return basePtsUs + (pcm.size.toLong() * 1_000_000L) / bytesPerSecond
  }

  private fun drainAndFinalize(session: EncodeFile, ptsUs: Long, isEos: Boolean) {
    if (isEos) {
      val inIndex = session.codec.dequeueInputBuffer(RecorderConstants.CODEC_DEQUEUE_TIMEOUT_US)
      if (inIndex >= 0) {
        session.codec.queueInputBuffer(
          inIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM,
        )
      }
    }
    drainEncoder(session, endOfStream = isEos)
  }

  private fun drainEncoder(session: EncodeFile, endOfStream: Boolean) {
    val info = MediaCodec.BufferInfo()
    val dequeueTimeoutUs = if (endOfStream) RecorderConstants.CODEC_DEQUEUE_TIMEOUT_US else 0L
    while (true) {
      val outIndex = session.codec.dequeueOutputBuffer(info, dequeueTimeoutUs)
      when {
        outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream) return
        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> startMuxer(session)
        outIndex >= 0 -> {
          if (writeOutputBuffer(session, outIndex, info)) return
        }
      }
    }
  }

  private fun startMuxer(session: EncodeFile) {
    if (session.muxerTrackIndex >= 0) {
      throw RecorderError("INTERNAL_ERROR", "Format changed after muxer start")
    }
    session.muxerTrackIndex = session.muxer.addTrack(session.codec.outputFormat)
    session.muxer.start()
    session.muxerStarted = true
  }

  private fun writeOutputBuffer(
    session: EncodeFile,
    outIndex: Int,
    info: MediaCodec.BufferInfo,
  ): Boolean {
    val outBuf: ByteBuffer = session.codec.getOutputBuffer(outIndex)
      ?: throw RecorderError("INTERNAL_ERROR", "Null output buffer")

    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0

    if (info.size > 0 && session.muxerStarted) {
      outBuf.position(info.offset)
      outBuf.limit(info.offset + info.size)
      session.muxer.writeSampleData(session.muxerTrackIndex, outBuf, info)
      session.bytesWritten += info.size
      totalBytesWritten += info.size
    }

    session.codec.releaseOutputBuffer(outIndex, false)
    return info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
  }

  private fun emitChunkComplete(session: EncodeFile, fileStartedAtMs: Long) {
    callbacks.onChunk(
      uri = "${RecorderConstants.URI_SCHEME}${session.path}",
      startMs = fileStartedAtMs,
      endMs = System.currentTimeMillis(),
      sizeBytes = session.bytesWritten,
    )
  }

  private fun resolveOutputDir(): File =
    config.outputDirectory?.let { File(it) }
      ?: File(context.cacheDir, RecorderConstants.DEFAULT_CACHE_SUBDIR)

  private fun openEncodeFile(): EncodeFile {
    return EncodeFile.open(
      outputDir = resolveOutputDir(),
      filenamePrefix = config.filenamePrefix ?: RecorderConstants.DEFAULT_FILENAME_PREFIX,
      sampleRate = config.sampleRate,
      channels = config.channels,
      aacBitrate = config.aacBitrate,
      maxInputSize = minBufferBytes * 2,
    )
  }

  private fun maybeEmitLevels(buffer: ByteArray, length: Int) {
    val now = System.currentTimeMillis()
    if (now - lastLevelEmitMs < config.audioLevelIntervalMs) return
    lastLevelEmitMs = now
    val levels = AudioLevelMeter.compute(buffer, length)
    callbacks.onAudioLevel(levels.rms, levels.peak)
  }

  private fun requirePermission() {
    val granted = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
    if (!granted) {
      throw RecorderError("PERMISSION_DENIED", "RECORD_AUDIO permission not granted")
    }
  }
}
