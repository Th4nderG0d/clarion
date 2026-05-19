package com.clarionhq.recorder

internal data class RecorderConfig(
  val sampleRate: Int,
  val channels: Int,
  val bitDepth: Int,
  val outputDirectory: String?,
  val filenamePrefix: String?,
  val rotateAfterMs: Long?,
  val emitAudioLevel: Boolean,
  val audioLevelIntervalMs: Int,
  val aacBitrate: Int,
) {
  init {
    require(sampleRate in setOf(8_000, 16_000, 22_050, 44_100, 48_000)) {
      "Unsupported sample rate: $sampleRate"
    }
    require(channels in 1..2) { "Channels must be 1 or 2, got $channels" }
    require(bitDepth == 16) { "Only 16-bit PCM is supported (got $bitDepth)" }
    require(aacBitrate in 16_000..256_000) { "AAC bitrate out of range: $aacBitrate" }
    require(audioLevelIntervalMs >= 10) { "audioLevelIntervalMs too low: $audioLevelIntervalMs" }
    rotateAfterMs?.let { require(it >= 1_000) { "rotateAfterMs must be >= 1000ms" } }
  }
}

internal data class RecorderResult(
  val uri: String,
  val durationMs: Long,
  val sizeBytes: Long,
  val sampleRate: Int,
  val channels: Int,
  val bitDepth: Int,
)
