package com.clarionhq.azure

/**
 * Internal error type thrown by the Android AzureSession.
 * Mapped to NativeAzureError at the Nitro bridge layer.
 */
internal class AzureError(
  val code: String,
  message: String,
  val recoverable: Boolean = false,
  cause: Throwable? = null,
) : Exception(message, cause)

internal data class AzureConfig(
  val language: String,
  val emitPartials: Boolean,
  val emitAudioLevel: Boolean,
  val audioLevelIntervalMs: Int,
  val subscriptionKey: String,
  val region: String,
  val authToken: String,
  val endpoint: String,
  val outputFormat: String,           // "simple" | "detailed"
  val profanity: String,              // "masked" | "removed" | "raw" | "none"
  val enableSpeakerDiarization: Boolean,
  val autoDetectLanguages: List<String>,
  // P6 additions
  val silenceTimeoutMs: Long,         // 0 = disabled
  val phraseHints: List<String>,      // empty = disabled
  val degradeOnTierMismatch: Boolean, // fall back to non-diarization when refused
)

/** Word-level segment. Azure populates these on detailed output + word-level timestamps. */
internal data class AzureSegment(
  val text: String,
  val startMs: Double,
  val durationMs: Double,
  /** -1 when unknown. */
  val confidence: Double,
  val alternatives: List<String>,
)

internal data class AzureTranscript(
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
  /** -1 when unknown. */
  val durationMs: Double,
  /** Empty unless diarization is enabled. */
  val speakerId: String,
  val segments: List<AzureSegment>,
)

internal interface AzureCallbacks {
  fun onState(state: String)
  fun onAudioLevel(rms: Double, peak: Double)
  fun onPartial(transcript: AzureTranscript)
  fun onFinal(transcript: AzureTranscript)
  fun onError(error: AzureError)
  /** `kind` = "started" or "ended". `offsetMs` in ms since session start, or -1 if unknown. */
  fun onSpeechBoundary(kind: String, offsetMs: Double)
}
