import Foundation
import Speech

/// Converts an `SFSpeechRecognitionResult` (or fallback partial text) into the
/// internal `RecognizerTranscript`, including per-word segments and confidence
/// aggregates. Kept separate from `RecognizerSession` so the session file can
/// focus on lifecycle/state.
internal enum TranscriptBuilder {

  /// Build a transcript from SFSpeech's structured result.
  static func from(
    result: SFSpeechRecognitionResult,
    sessionId: String,
    sessionStartMs: Double,
    language: String
  ) -> RecognizerTranscript {
    let best = result.bestTranscription
    let segments = best.segments.map { segment -> RecognizerSegment in
      RecognizerSegment(
        text: segment.substring,
        startMs: segment.timestamp * 1_000,
        durationMs: segment.duration * 1_000,
        confidence: Double(segment.confidence),
        alternatives: segment.alternativeSubstrings
      )
    }
    let avgConfidence: Double = segments.isEmpty
      ? -1
      : (segments.reduce(0.0) { $0 + max($1.confidence, 0) } / Double(segments.count))
    let durationMs: Double = segments.isEmpty
      ? -1
      : segments.reduce(0.0) { max($0, $1.startMs + $1.durationMs) }
    let nowMs = Date().timeIntervalSince1970 * 1_000
    return RecognizerTranscript(
      id: UUID().uuidString,
      sessionId: sessionId,
      timestamp: nowMs,
      text: best.formattedString,
      isFinal: result.isFinal,
      language: language,
      confidence: avgConfidence,
      offsetMs: nowMs - sessionStartMs,
      durationMs: durationMs,
      segments: segments
    )
  }

  /// Build a transcript when we only have a text string (timeout fallback,
  /// discard with last partial, etc.).
  static func from(
    text: String,
    isFinal: Bool,
    sessionId: String,
    sessionStartMs: Double,
    language: String
  ) -> RecognizerTranscript {
    let nowMs = Date().timeIntervalSince1970 * 1_000
    return RecognizerTranscript(
      id: UUID().uuidString,
      sessionId: sessionId,
      timestamp: nowMs,
      text: text,
      isFinal: isFinal,
      language: language,
      confidence: -1,
      offsetMs: nowMs - sessionStartMs,
      durationMs: -1,
      segments: []
    )
  }
}
