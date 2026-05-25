package com.clarionhq.recognizer

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Requests audio focus on prepare(), abandons it on release. Surfaces
 * focus-loss events (other app grabs audio, ducking required, etc.) via the
 * callback. Designed to match `AudioSessionMonitor` on iOS so the rest of
 * the engine can stay platform-agnostic.
 */
internal class AudioFocusMonitor(
  private val context: Context,
  private val onFocusLost: (transient: Boolean) -> Unit,
  private val onFocusRegained: () -> Unit,
) {
  private val audioManager: AudioManager =
    context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private var focusRequest: AudioFocusRequest? = null

  private val listener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS -> onFocusLost(false)
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> onFocusLost(true)
      AudioManager.AUDIOFOCUS_GAIN -> onFocusRegained()
    }
  }

  /** Request audio focus. Returns true if granted. */
  fun acquire(): Boolean {
    val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attrs)
        .setAcceptsDelayedFocusGain(false)
        .setOnAudioFocusChangeListener(listener)
        .build()
      focusRequest = req
      audioManager.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        listener,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN,
      ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    return granted
  }

  /** Abandon audio focus. Safe to call multiple times. */
  fun release() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(listener)
    }
  }
}
