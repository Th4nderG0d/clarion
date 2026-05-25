package com.clarionhq.azure

import com.clarionhq.azure.AzureConstants.TICKS_PER_MS
import com.clarionhq.azure.AzureConstants.UNKNOWN
import com.microsoft.cognitiveservices.speech.PropertyId
import com.microsoft.cognitiveservices.speech.RecognitionResult
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

/**
 * Converts an Azure SDK recognition result into [AzureTranscript].
 * Parses the `SpeechServiceResponse_JsonResult` property when detailed output
 * is requested, to populate per-word segments + aggregate confidence.
 *
 * The detailed JSON payload exposes `NBest[0].Words` (per-word offset/duration/confidence
 * in ticks — see [AzureConstants.TICKS_PER_MS] for the ticks→ms conversion) and
 * `PrimaryLanguage.Language` when auto-detect is enabled.
 */
internal object AzureTranscriptBuilder {

  /**
   * Build a transcript from an Azure recognition result. Accepts the base
   * [RecognitionResult] so both `SpeechRecognitionResult` and
   * `ConversationTranscriptionResult` flow through the same code path — the
   * diarization-aware speakerId is supplied by the caller.
   */
  fun from(
    result: RecognitionResult,
    isFinal: Boolean,
    sessionId: String,
    sessionStartMs: Double,
    fallbackLanguage: String,
    speakerId: String = "",
  ): AzureTranscript {
    val text = result.text ?: ""
    val base = fromText(
      text = text,
      isFinal = isFinal,
      sessionId = sessionId,
      sessionStartMs = sessionStartMs,
      language = fallbackLanguage,
    )

    val jsonRaw = result.properties?.getProperty(PropertyId.SpeechServiceResponse_JsonResult) ?: ""
    val parsed = parseDetailedJson(jsonRaw)

    val rawOffsetMs = ticksToMs(result.offset?.toLong() ?: 0L)
    val rawDurationMs = ticksToMs(result.duration?.toLong() ?: 0L)
    val offsetMs = if (rawOffsetMs > 0) rawOffsetMs else base.offsetMs
    val durationMs = if (rawDurationMs > 0) rawDurationMs else UNKNOWN

    return base.copy(
      language = parsed?.language ?: fallbackLanguage,
      confidence = parsed?.confidence ?: UNKNOWN,
      offsetMs = offsetMs,
      durationMs = durationMs,
      speakerId = speakerId,
      segments = parsed?.words ?: emptyList(),
    )
  }

  /** Build a transcript from a plain text string (stitched session-final, discard fallback, etc.). */
  fun fromText(
    text: String,
    isFinal: Boolean,
    sessionId: String,
    sessionStartMs: Double,
    language: String,
  ): AzureTranscript {
    val nowMs = System.currentTimeMillis().toDouble()
    return AzureTranscript(
      id = UUID.randomUUID().toString(),
      sessionId = sessionId,
      timestamp = nowMs,
      text = text,
      isFinal = isFinal,
      language = language,
      confidence = UNKNOWN,
      offsetMs = nowMs - sessionStartMs,
      durationMs = UNKNOWN,
      speakerId = "",
      segments = emptyList(),
    )
  }

  // MARK: helpers

  private fun ticksToMs(ticks: Long): Double = ticks / TICKS_PER_MS

  // MARK: JSON parsing

  private data class ParsedDetailed(
    val words: List<AzureSegment>,
    val confidence: Double,
    val language: String?,
  )

  private fun parseDetailedJson(raw: String): ParsedDetailed? {
    if (raw.isEmpty()) return null
    return try {
      val obj = JSONObject(raw)

      val language: String? = obj.optJSONObject("PrimaryLanguage")
        ?.optString("Language")?.takeIf { it.isNotEmpty() }

      val nBest = obj.optJSONArray("NBest") ?: return null
      if (nBest.length() == 0) return null
      val first = nBest.optJSONObject(0) ?: return null

      val confidence = first.optDouble("Confidence", UNKNOWN)
      val wordsArr = first.optJSONArray("Words")
      val words = mutableListOf<AzureSegment>()
      if (wordsArr != null) {
        for (i in 0 until wordsArr.length()) {
          val w = wordsArr.optJSONObject(i) ?: continue
          val wText = w.optString("Word", "")
          if (wText.isEmpty()) continue
          words += AzureSegment(
            text = wText,
            startMs = ticksToMs(w.optLong("Offset", 0L)),
            durationMs = ticksToMs(w.optLong("Duration", 0L)),
            confidence = w.optDouble("Confidence", UNKNOWN),
            alternatives = emptyList(),
          )
        }
      }
      ParsedDetailed(words = words, confidence = confidence, language = language)
    } catch (_: JSONException) {
      null
    }
  }
}
