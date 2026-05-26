package com.clarionhq.audio_tap

/**
 * Internal throwable. Mapped to `NativeAudioTapError` at the bridge layer
 * (`HybridClarionAudioTap`).
 */
internal class AudioTapError(
  val code: String,
  override val message: String,
  val recoverable: Boolean = false,
) : RuntimeException(message)

internal interface AudioTapCallbacks {
  fun onState(state: String)
  fun onFrame(
    pcm: ByteArray,
    timestamp: Double,
    frameIndex: Long,
    sampleRate: Int,
    channels: Int,
    bitsPerSample: Int,
  )
  fun onStats(
    uptimeMs: Double,
    framesEmitted: Long,
    framesDropped: Long,
    bufferFillPct: Double,
  )
  fun onError(error: AudioTapError)
}
