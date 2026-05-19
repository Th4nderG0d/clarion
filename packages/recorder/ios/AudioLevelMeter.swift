import AVFoundation
import Foundation

internal struct AudioLevels {
  let rms: Double
  let peak: Double
}

internal enum AudioLevelMeter {
  static func compute(buffer: AVAudioPCMBuffer) -> AudioLevels {
    guard let floatData = buffer.floatChannelData else {
      return AudioLevels(rms: 0, peak: 0)
    }
    let channelCount = Int(buffer.format.channelCount)
    let frameCount = Int(buffer.frameLength)
    if frameCount == 0 || channelCount == 0 {
      return AudioLevels(rms: 0, peak: 0)
    }

    var sumSquares: Double = 0
    var peakAbs: Float = 0

    for channel in 0..<channelCount {
      let samples = floatData[channel]
      for frame in 0..<frameCount {
        let sample = samples[frame]
        let absSample = abs(sample)
        if absSample > peakAbs { peakAbs = absSample }
        sumSquares += Double(sample) * Double(sample)
      }
    }

    let totalSamples = Double(frameCount * channelCount)
    let rms = (sumSquares > 0) ? (sumSquares / totalSamples).squareRoot() : 0
    return AudioLevels(rms: min(rms, 1.0), peak: min(Double(peakAbs), 1.0))
  }
}
