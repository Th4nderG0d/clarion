import Foundation

internal enum RecorderConstants {
  static let defaultCacheSubdir = "clarion-recorder"
  static let defaultFilenamePrefix = "clarion"
  static let outputExtension = "m4a"
  static let uriScheme = "file://"
  static let captureBufferFractionOfSecond: UInt32 = 5
  static let writeQueueLabel = "dev.clarionhq.recorder.write"
  static let captureQueueLabel = "dev.clarionhq.recorder.capture"
}
