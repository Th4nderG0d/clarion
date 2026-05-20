package com.clarionhq.recognizer

import android.speech.SpeechRecognizer

/**
 * Maps Android's `SpeechRecognizer.ERROR_*` int codes to our `RecognizerError`
 * (which surfaces as the cross-platform `ClarionError.code` enum on the JS side).
 */
internal fun mapAndroidSpeechError(code: Int, language: String): RecognizerError = when (code) {
  SpeechRecognizer.ERROR_NETWORK ->
    RecognizerError("NETWORK_UNAVAILABLE", "Network unavailable for recognition", recoverable = true)
  SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
    RecognizerError("NETWORK_TIMEOUT", "Network timeout during recognition", recoverable = true)
  SpeechRecognizer.ERROR_AUDIO ->
    RecognizerError("AUDIO_BUSY", "Audio recording error", recoverable = true)
  SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
    RecognizerError("PERMISSION_DENIED", "RECORD_AUDIO permission denied")
  SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
    RecognizerError("AUDIO_BUSY", "Recognizer is busy with another request", recoverable = true)
  SpeechRecognizer.ERROR_NO_MATCH ->
    RecognizerError("NO_SPEECH", "No recognition match", recoverable = true)
  SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
    RecognizerError("NO_SPEECH", "No speech input detected", recoverable = true)
  SpeechRecognizer.ERROR_CLIENT ->
    RecognizerError("INTERNAL_ERROR", "SpeechRecognizer client error")
  SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED ->
    RecognizerError("INTERNAL_ERROR", "SpeechRecognizer server error", recoverable = true)
  SpeechRecognizer.ERROR_TOO_MANY_REQUESTS ->
    RecognizerError("INTERNAL_ERROR", "Too many recognition requests", recoverable = true)
  SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
    RecognizerError("UNSUPPORTED_LANGUAGE", "Language not supported: $language")
  SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
    RecognizerError("UNSUPPORTED_LANGUAGE", "Language model unavailable: $language", recoverable = true)
  else ->
    RecognizerError("INTERNAL_ERROR", "Unknown SpeechRecognizer error code: $code")
}
