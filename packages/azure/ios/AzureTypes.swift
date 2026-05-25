import Foundation

/// Internal error type thrown by the iOS AzureSession.
/// Mapped to NativeAzureError at the Nitro bridge layer.
internal struct AzureError: Error, CustomStringConvertible {
  let code: String
  let message: String
  let recoverable: Bool

  init(code: String, message: String, recoverable: Bool = false) {
    self.code = code
    self.message = message
    self.recoverable = recoverable
  }

  var description: String { "[\(code)] \(message)" }
}

internal struct AzureConfig {
  let language: String
  let emitPartials: Bool
  let emitAudioLevel: Bool
  let audioLevelIntervalMs: Double

  // Auth — exactly one combination must be present.
  let subscriptionKey: String
  let region: String
  let authToken: String
  let endpoint: String

  let outputFormat: String           // "simple" | "detailed"
  let profanity: String              // "masked" | "removed" | "raw" | "none"
  let enableSpeakerDiarization: Bool
  let autoDetectLanguages: [String]  // empty = disabled

  // P6 additions
  let silenceTimeoutMs: Double       // 0 = disabled
  let phraseHints: [String]          // empty = disabled
  let degradeOnTierMismatch: Bool    // fall back to non-diarization if needed
}

internal struct AzureSegment {
  let text: String
  let startMs: Double
  let durationMs: Double
  let confidence: Double  // -1 when unknown
  let alternatives: [String]
}

internal struct AzureTranscript {
  let id: String
  let sessionId: String
  let timestamp: Double
  let text: String
  let isFinal: Bool
  let language: String
  let confidence: Double  // -1 when unknown
  let offsetMs: Double    // -1 when unknown
  let durationMs: Double  // -1 when unknown
  let speakerId: String   // empty when diarization off
  let segments: [AzureSegment]
}

internal protocol AzureCallbacks: AnyObject {
  func onState(_ state: String)
  func onAudioLevel(rms: Double, peak: Double)
  func onPartial(_ transcript: AzureTranscript)
  func onFinal(_ transcript: AzureTranscript)
  func onError(_ error: AzureError)
  /// `kind` is `"started"` or `"ended"`. `offsetMs` is -1 when unknown.
  func onSpeechBoundary(kind: String, offsetMs: Double)
}
