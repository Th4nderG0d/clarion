package com.clarionhq.recognizer

import android.os.Bundle
import android.speech.SpeechRecognizer
import java.util.UUID

/** Inputs needed to assemble a [RecognizerTranscript]. */
internal data class TranscriptContext(
  val sessionId: String,
  val sessionStartMs: Double,
  val language: String,
)

/**
 * Single entry point that wraps the loosely-typed Android Bundle (or a
 * fallback partial string) into our typed [RecognizerTranscript].
 */
internal object TranscriptBuilder {

  fun fromBundle(
    bundle: Bundle?,
    isFinal: Boolean,
    ctx: TranscriptContext,
  ): RecognizerTranscript {
    val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      ?.firstOrNull().orEmpty()
    val confidence = bundle?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
      ?.firstOrNull()?.toDouble() ?: -1.0
    return fromText(text, isFinal, ctx, confidence)
  }

  fun fromText(
    text: String,
    isFinal: Boolean,
    ctx: TranscriptContext,
    confidence: Double = -1.0,
  ): RecognizerTranscript {
    val nowMs = System.currentTimeMillis().toDouble()
    return RecognizerTranscript(
      id = UUID.randomUUID().toString(),
      sessionId = ctx.sessionId,
      timestamp = nowMs,
      text = text,
      isFinal = isFinal,
      language = ctx.language,
      confidence = confidence,
      offsetMs = nowMs - ctx.sessionStartMs,
      durationMs = -1.0,
      segments = emptyList(),
    )
  }
}
