import AVFoundation
import Foundation

/// Wraps a single AVAudioFile write target. Simpler than driving AVAssetWriter
/// directly — the file negotiates AAC encoding internally and accepts
/// AVAudioPCMBuffer in our chosen PCM format without any CMSampleBuffer dance.
internal final class EncodeFile {
  let url: URL
  private var audioFile: AVAudioFile?
  private(set) var bytesWritten: Int64 = 0
  private(set) var finished: Bool = false

  private init(url: URL) {
    self.url = url
  }

  static func open(
    in directory: URL,
    filenamePrefix: String,
    sampleRate: Double,
    channels: UInt32,
    aacBitrate: Int
  ) throws -> EncodeFile {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let filename = "\(filenamePrefix)-\(UUID().uuidString).\(RecorderConstants.outputExtension)"
    let url = directory.appendingPathComponent(filename)

    // Don't pass AVEncoderBitRateKey — iOS rejects bitrates that the encoder's
    // tables don't list as valid for the (sampleRate, channels) combo with
    // kAudioFormatUnsupportedDataFormatError. Letting the encoder pick a
    // sensible default for the format is the robust path.
    var outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
    ]
    // 32 kbps is the safe AAC-LC bitrate for 16 kHz mono. Apply only when
    // explicitly requested via a sensible value; otherwise rely on the default.
    if aacBitrate > 0 && aacBitrate <= 48_000 {
      outputSettings[AVEncoderBitRateKey] = aacBitrate
    }

    let file = EncodeFile(url: url)
    file.audioFile = try AVAudioFile(
      forWriting: url,
      settings: outputSettings,
      commonFormat: .pcmFormatInt16,
      interleaved: true
    )
    return file
  }

  func write(buffer: AVAudioPCMBuffer) throws {
    guard !finished, let audioFile else { return }
    try audioFile.write(from: buffer)
    let bytesPerFrame = Int64(buffer.format.streamDescription.pointee.mBytesPerFrame)
    bytesWritten += Int64(buffer.frameLength) * bytesPerFrame
  }

  func close() {
    finished = true
    audioFile = nil
  }

  func cancel() {
    close()
    try? FileManager.default.removeItem(at: url)
  }
}
