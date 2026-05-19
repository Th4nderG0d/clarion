package com.clarionhq.recorder

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

internal data class AudioLevels(val rms: Double, val peak: Double)

internal object AudioLevelMeter {
  private const val PCM_16_MAX = 32_768.0

  fun compute(pcm: ByteArray, length: Int): AudioLevels {
    if (length < 2) return AudioLevels(0.0, 0.0)

    val sampleCount = length / 2
    var sumSquares = 0.0
    var peakAbs = 0

    var i = 0
    while (i < length - 1) {
      val low = pcm[i].toInt() and 0xFF
      val high = pcm[i + 1].toInt()
      val sample = (high shl 8) or low
      val signed = if (sample > 32_767) sample - 65_536 else sample

      val abs = abs(signed)
      if (abs > peakAbs) peakAbs = abs

      val normalized = signed.toDouble()
      sumSquares += normalized * normalized
      i += 2
    }

    val rms = sqrt(sumSquares / sampleCount) / PCM_16_MAX
    val peak = peakAbs.toDouble() / PCM_16_MAX
    return AudioLevels(min(rms, 1.0), min(peak, 1.0))
  }
}
