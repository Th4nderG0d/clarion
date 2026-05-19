import Foundation

internal struct RecorderError: Error {
  let code: String
  let message: String
  let recoverable: Bool

  init(code: String, message: String, recoverable: Bool = false) {
    self.code = code
    self.message = message
    self.recoverable = recoverable
  }
}

internal struct RecorderConfig {
  let sampleRate: Double
  let channels: UInt32
  let bitDepth: UInt32
  let outputDirectory: String?
  let filenamePrefix: String?
  let rotateAfterMs: Double?
  let emitAudioLevel: Bool
  let audioLevelIntervalMs: Double
  let aacBitrate: Int
}

internal struct RecorderOutput {
  let uri: String
  let durationMs: Double
  let sizeBytes: Double
  let sampleRate: Double
  let channels: UInt32
  let bitDepth: UInt32
}

internal protocol RecorderCallbacks: AnyObject {
  func onState(_ state: String)
  func onAudioLevel(rms: Double, peak: Double)
  func onChunk(uri: String, startMs: Double, endMs: Double, sizeBytes: Double)
  func onError(_ error: RecorderError)
}
