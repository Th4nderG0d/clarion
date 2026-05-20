package com.clarionhq.recognizer

internal object RecognizerConstants {
  /**
   * Android's RecognitionListener.onRmsChanged emits a value loosely in
   * the range [-2, 10] (vendor-defined, not a true dB). We linearly clamp
   * to [0, 1] using these bounds. Documented at:
   * https://developer.android.com/reference/android/speech/RecognitionListener#onRmsChanged(float)
   */
  const val RMS_MIN: Float = -2f
  const val RMS_MAX: Float = 10f

  const val STOP_RESULT_TIMEOUT_MS: Long = 8_000L
}
