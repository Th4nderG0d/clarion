import Foundation

/// Internal error type thrown by the iOS RecognizerSession.
/// Mapped to NativeRecognizerError at the Nitro bridge layer.
internal struct RecognizerError: Error, CustomStringConvertible {
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

internal struct RecognizerConfig {
  let language: String
  let emitPartials: Bool
  let emitAudioLevel: Bool
  let audioLevelIntervalMs: Double
  let preferOnDevice: Bool
}

internal struct RecognizerSegment {
  let text: String
  let startMs: Double
  let durationMs: Double
  let confidence: Double  // -1 when unknown
  let alternatives: [String]
}

internal struct RecognizerTranscript {
  let id: String
  let sessionId: String
  let timestamp: Double
  let text: String
  let isFinal: Bool
  let language: String
  let confidence: Double      // -1 when unknown
  let offsetMs: Double        // -1 when unknown
  let durationMs: Double      // -1 when unknown
  let segments: [RecognizerSegment]
}

internal protocol RecognizerCallbacks: AnyObject {
  func onState(_ state: String)
  func onAudioLevel(rms: Double, peak: Double)
  func onPartial(_ transcript: RecognizerTranscript)
  func onFinal(_ transcript: RecognizerTranscript)
  func onError(_ error: RecognizerError)
}
