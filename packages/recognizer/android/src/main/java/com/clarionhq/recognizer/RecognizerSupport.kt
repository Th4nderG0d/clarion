package com.clarionhq.recognizer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * Static availability helpers exposed via the Nitro bridge as
 * `isAvailable(language)` and `supportedLocales()`.
 *
 * Android doesn't ship a synchronous "list supported languages" API — you
 * have to send an ordered broadcast and wait for the recognizer service to
 * fill in the result extras. We bound the wait to 2 seconds so callers
 * aren't left hanging on a misconfigured device.
 */
internal object RecognizerSupport {

  private const val QUERY_TIMEOUT_MS = 2_000L

  suspend fun querySupportedLocales(context: Context): List<String> {
    if (!SpeechRecognizer.isRecognitionAvailable(context)) return emptyList()
    val deferred = CompletableDeferred<List<String>>()
    val intent = Intent(RecognizerIntent.ACTION_GET_LANGUAGE_DETAILS)
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, i: Intent?) {
        val extras: Bundle = getResultExtras(true) ?: Bundle()
        val supported = extras.getStringArrayList(RecognizerIntent.EXTRA_SUPPORTED_LANGUAGES)
        deferred.complete(supported?.toList() ?: emptyList())
      }
    }
    context.sendOrderedBroadcast(intent, null, receiver, null, 0, null, null)
    return try {
      withTimeout(QUERY_TIMEOUT_MS) { deferred.await() }
    } catch (_: TimeoutCancellationException) {
      emptyList()
    }
  }

  suspend fun isLocaleAvailable(context: Context, language: String): Boolean {
    if (!SpeechRecognizer.isRecognitionAvailable(context)) return false
    val locales = querySupportedLocales(context)
    if (locales.isEmpty()) {
      // Recognizer is available but service didn't report a language list —
      // we conservatively say true, the caller will see the real error if
      // they try to use it.
      return true
    }
    val lc = language.lowercase()
    return locales.any { it.lowercase() == lc || it.lowercase().startsWith("$lc-") || lc.startsWith(it.lowercase() + "-") }
  }
}
