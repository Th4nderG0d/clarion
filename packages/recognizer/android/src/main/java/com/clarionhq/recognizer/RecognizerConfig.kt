package com.clarionhq.recognizer

internal data class RecognizerConfig(
  val language: String,
  val emitPartials: Boolean,
  val emitAudioLevel: Boolean,
  val audioLevelIntervalMs: Int,
  val preferOnDevice: Boolean,
) {
  init {
    require(language.isNotBlank()) { "language must be a non-empty BCP-47 tag" }
    require(audioLevelIntervalMs >= 10) {
      "audioLevelIntervalMs too low: $audioLevelIntervalMs"
    }
  }
}
