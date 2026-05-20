package com.clarionhq.recognizer

/**
 * Internal error type thrown by the Android RecognizerSession.
 * Mapped to NativeRecognizerError at the Nitro bridge layer.
 */
internal class RecognizerError(
  val code: String,
  message: String,
  val recoverable: Boolean = false,
  cause: Throwable? = null,
) : Exception(message, cause)

/** Word-level segment. Android natively doesn't expose these — kept for parity. */
internal data class RecognizerSegment(
  val text: String,
  val startMs: Double,
  val durationMs: Double,
  /** -1 when unknown. */
  val confidence: Double,
  val alternatives: List<String>,
)

internal data class RecognizerTranscript(
  val id: String,
  val sessionId: String,
  val timestamp: Double,
  val text: String,
  val isFinal: Boolean,
  val language: String,
  /** -1 when unknown. */
  val confidence: Double,
  /** -1 when unknown. */
  val offsetMs: Double,
  /** -1 — Android's SpeechRecognizer doesn't report this. */
  val durationMs: Double,
  /** Empty — Android doesn't report per-word segments. */
  val segments: List<RecognizerSegment>,
)

internal interface RecognizerCallbacks {
  fun onState(state: String)
  fun onAudioLevel(rms: Double, peak: Double)
  fun onPartial(transcript: RecognizerTranscript)
  fun onFinal(transcript: RecognizerTranscript)
  fun onError(error: RecognizerError)
}
