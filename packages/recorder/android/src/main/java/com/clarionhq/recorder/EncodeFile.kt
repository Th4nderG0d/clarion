package com.clarionhq.recorder

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.util.UUID

internal class EncodeFile private constructor(
  val path: String,
  val codec: MediaCodec,
  val muxer: MediaMuxer,
) {
  var muxerTrackIndex: Int = -1
  var muxerStarted: Boolean = false
  var bytesWritten: Long = 0L

  fun close() {
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { if (muxerStarted) muxer.stop() }
    runCatching { muxer.release() }
  }

  companion object {
    fun open(
      outputDir: File,
      filenamePrefix: String,
      sampleRate: Int,
      channels: Int,
      aacBitrate: Int,
      maxInputSize: Int,
    ): EncodeFile {
      if (!outputDir.exists()) outputDir.mkdirs()

      val file = File(
        outputDir,
        "$filenamePrefix-${UUID.randomUUID()}.${RecorderConstants.OUTPUT_EXTENSION}",
      )

      val format = MediaFormat.createAudioFormat(
        MediaFormat.MIMETYPE_AUDIO_AAC,
        sampleRate,
        channels,
      ).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, aacBitrate)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, maxInputSize)
      }

      val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
        configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        start()
      }

      val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

      return EncodeFile(path = file.absolutePath, codec = codec, muxer = muxer)
    }
  }
}
