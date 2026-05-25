import Foundation
import MicrosoftCognitiveServicesSpeech

/// Converts an Azure SDK recognition result into the internal `AzureTranscript`.
/// Parses the `SpeechServiceResponse_JsonResult` property when detailed output
/// is requested, to populate per-word segments + aggregate confidence.
///
/// Detailed JSON shape (when `OutputFormat.detailed` + `requestWordLevelTimestamps`):
/// ```
/// {
///   "RecognitionStatus": "Success",
///   "Offset": 1230000,           // 100-ns ticks
///   "Duration": 5670000,
///   "DisplayText": "Hello world.",
///   "NBest": [{
///     "Confidence": 0.92,
///     "Lexical": "hello world",
///     "Display": "Hello world.",
///     "Words": [
///       {"Word": "hello", "Offset": 1230000, "Duration": 2230000, "Confidence": 0.94},
///       ...
///     ]
///   }]
/// }
/// ```
internal enum AzureTranscriptBuilder {

  /// Build a transcript from an Azure recognition event result. Accepts the
  /// base `SPXRecognitionResult` so both `SPXSpeechRecognitionResult` and
  /// `SPXConversationTranscriptionResult` flow through the same code path —
  /// the diarization-aware speakerId is supplied by the caller.
  static func from(
    result: SPXRecognitionResult,
    isFinal: Bool,
    sessionId: String,
    sessionStartMs: Double,
    fallbackLanguage: String,
    speakerId: String = ""
  ) -> AzureTranscript {
    let nowMs = Date().timeIntervalSince1970 * 1_000
    let text = result.text ?? ""

    // Azure offset/duration are in 100-ns ticks → convert to ms (÷ 10,000).
    let resultOffsetMs = Double(result.offset) / 10_000.0
    let resultDurationMs = Double(result.duration) / 10_000.0

    // Parse the detailed JSON payload if present.
    let jsonRaw = result.properties?.getPropertyBy(SPXPropertyId.speechServiceResponseJsonResult) ?? ""
    let parsed = parseDetailedJson(jsonRaw)

    let segments = parsed?.words ?? []
    let confidence = parsed?.confidence ?? -1
    let detectedLanguage = parsed?.language ?? fallbackLanguage

    return AzureTranscript(
      id: UUID().uuidString,
      sessionId: sessionId,
      timestamp: nowMs,
      text: text,
      isFinal: isFinal,
      language: detectedLanguage,
      confidence: confidence,
      offsetMs: resultOffsetMs >= 0 ? resultOffsetMs : (nowMs - sessionStartMs),
      durationMs: resultDurationMs > 0 ? resultDurationMs : -1,
      speakerId: speakerId,
      segments: segments
    )
  }

  /// Build a transcript when we only have a text string (stitched session
  /// transcript on stop(), or discard with last partial).
  static func fromText(
    _ text: String,
    isFinal: Bool,
    sessionId: String,
    sessionStartMs: Double,
    language: String
  ) -> AzureTranscript {
    let nowMs = Date().timeIntervalSince1970 * 1_000
    return AzureTranscript(
      id: UUID().uuidString,
      sessionId: sessionId,
      timestamp: nowMs,
      text: text,
      isFinal: isFinal,
      language: language,
      confidence: -1,
      offsetMs: nowMs - sessionStartMs,
      durationMs: -1,
      speakerId: "",
      segments: []
    )
  }

  // MARK: JSON parsing

  private struct ParsedDetailed {
    let words: [AzureSegment]
    let confidence: Double
    let language: String?
  }

  private static func parseDetailedJson(_ raw: String) -> ParsedDetailed? {
    guard !raw.isEmpty, let data = raw.data(using: .utf8) else { return nil }
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }

    // Some payloads expose "PrimaryLanguage" when auto-detect is on.
    let language: String? = (obj["PrimaryLanguage"] as? [String: Any])?["Language"] as? String

    guard let nBest = obj["NBest"] as? [[String: Any]], let first = nBest.first else {
      return nil
    }

    let confidence: Double = (first["Confidence"] as? Double) ?? -1
    let wordsJson = first["Words"] as? [[String: Any]] ?? []

    let words: [AzureSegment] = wordsJson.compactMap { w in
      guard let text = w["Word"] as? String else { return nil }
      let offsetTicks = (w["Offset"] as? Double) ?? 0
      let durationTicks = (w["Duration"] as? Double) ?? 0
      let wConfidence = (w["Confidence"] as? Double) ?? -1
      return AzureSegment(
        text: text,
        startMs: offsetTicks / 10_000.0,
        durationMs: durationTicks / 10_000.0,
        confidence: wConfidence,
        alternatives: []
      )
    }

    return ParsedDetailed(words: words, confidence: confidence, language: language)
  }
}
