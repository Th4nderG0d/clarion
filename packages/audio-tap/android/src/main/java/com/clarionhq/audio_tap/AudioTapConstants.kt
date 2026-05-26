package com.clarionhq.audio_tap

internal object AudioTapConstants {
  const val MS_PER_SECOND = 1000
  const val BITS_PER_BYTE = 8

  /** Read buffer is sized to hold this many output frames so the JS layer
   *  has slack on slow devices before the OS starts dropping samples. */
  const val READ_BUFFER_FRAMES_MULTIPLIER = 10

  /** ms between consecutive stats emissions. */
  const val STATS_INTERVAL_MS = 1000L

  /** Max time we wait for the capture thread to finish on stop(). */
  const val CAPTURE_THREAD_JOIN_TIMEOUT_MS = 500L

  /** Max time we wait for the stats thread to finish on stop(). */
  const val STATS_THREAD_JOIN_TIMEOUT_MS = 200L
}
