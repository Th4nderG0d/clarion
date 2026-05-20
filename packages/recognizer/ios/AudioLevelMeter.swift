import AVFoundation
import Foundation

/// Computes RMS and peak amplitude from a float32 PCM buffer, normalized to 0..1.
/// Shared by the recorder's clean PCM-derived meter and the recognizer's tap.
internal enum AudioLevelMeter {
  struct Levels {
    let rms: Double
    let peak: Double
  }

  static func compute(buffer: AVAudioPCMBuffer) -> Levels {
    guard let channelData = buffer.floatChannelData else {
      return Levels(rms: 0, peak: 0)
    }
    let channels = Int(buffer.format.channelCount)
    let frames = Int(buffer.frameLength)
    if frames == 0 { return Levels(rms: 0, peak: 0) }

    var sumSq: Double = 0
    var peak: Double = 0
    for c in 0..<channels {
      let ptr = channelData[c]
      for f in 0..<frames {
        let s = Double(ptr[f])
        let absS = abs(s)
        if absS > peak { peak = absS }
        sumSq += s * s
      }
    }
    let totalSamples = Double(frames * channels)
    let rms = (sumSq / totalSamples).squareRoot()
    return Levels(rms: min(rms, 1.0), peak: min(peak, 1.0))
  }
}
