package com.clarionhq.azure

internal object AzureConstants {
  /** Azure SDK reports offset/duration in 100-ns "ticks". Divide by this to get milliseconds. */
  const val TICKS_PER_MS: Double = 10_000.0

  /** Sentinel for "value unknown" inside [AzureTranscript] / [AzureSegment] fields. */
  const val UNKNOWN: Double = -1.0

  /** Max wait for `stopContinuousRecognitionAsync` to fire `sessionStopped`, in ms. */
  const val STOP_TIMEOUT_MS: Long = 5_000
}
