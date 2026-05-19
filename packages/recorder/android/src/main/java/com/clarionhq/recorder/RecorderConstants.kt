package com.clarionhq.recorder

internal object RecorderConstants {
  const val CODEC_DEQUEUE_TIMEOUT_US = 10_000L
  const val PCM_QUEUE_POLL_TIMEOUT_MS = 200L
  const val ENCODE_THREAD_JOIN_TIMEOUT_MS = 3_000L
  const val CAPTURE_THREAD_JOIN_TIMEOUT_MS = 1_000L
  const val CANCEL_ENCODE_JOIN_TIMEOUT_MS = 1_000L
  const val CANCEL_CAPTURE_JOIN_TIMEOUT_MS = 500L
  const val PCM_QUEUE_CAPACITY = 128
  const val CAPTURE_BUFFER_FRACTION_OF_SECOND = 5
  const val DEFAULT_CACHE_SUBDIR = "clarion-recorder"
  const val DEFAULT_FILENAME_PREFIX = "clarion"
  const val OUTPUT_EXTENSION = "m4a"
  const val URI_SCHEME = "file://"
}
