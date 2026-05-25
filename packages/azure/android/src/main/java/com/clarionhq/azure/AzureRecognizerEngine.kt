package com.clarionhq.azure

import com.microsoft.cognitiveservices.speech.CancellationErrorCode
import com.microsoft.cognitiveservices.speech.CancellationReason
import com.microsoft.cognitiveservices.speech.Recognizer
import com.microsoft.cognitiveservices.speech.RecognitionResult
import com.microsoft.cognitiveservices.speech.SpeechRecognizer
import com.microsoft.cognitiveservices.speech.SpeechConfig
import com.microsoft.cognitiveservices.speech.audio.AudioConfig
import com.microsoft.cognitiveservices.speech.transcription.ConversationTranscriber

/**
 * Receives normalized events from either [SpeechRecognizer] or
 * [ConversationTranscriber] so [AzureSession] can stay engine-agnostic.
 */
internal interface AzureRecognizerCallbacks {
  fun azureRecognizing(result: RecognitionResult, speakerId: String)
  fun azureRecognized(result: RecognitionResult, speakerId: String)
  fun azureCanceled(
    reason: CancellationReason?,
    errorCode: CancellationErrorCode?,
    errorDetails: String?,
  )
  fun azureSessionStopped()
  /** `kind` = "started" or "ended", `offsetMs` in ms since session start (-1 if unknown). */
  fun azureSpeechBoundary(kind: String, offsetMs: Double)
}

/**
 * Internal-only abstraction over the two Azure recognizer flavors.
 * Both wrappers expose the same lifecycle so [AzureSession] doesn't have to
 * branch on diarization in every method.
 */
internal interface AzureRecognizerEngine {
  /** Underlying SDK recognizer — exposed for property-bag access and tests. */
  val sdkRecognizer: Recognizer

  fun startAsync(): java.util.concurrent.Future<Void>
  fun stopAsync(): java.util.concurrent.Future<Void>
  fun close()

  /**
   * Hot-swap the auth token on the property bag of the concrete recognizer.
   * Base [Recognizer] doesn't expose this — each impl pokes its own subclass's
   * `properties` collection instead, which the SDK reads on next reconnect.
   */
  fun updateAuthToken(token: String)
}

// region — Speech recognition wrapper (no diarization)

internal class AzureSpeechRecognizerEngineImpl(
  speechConfig: SpeechConfig,
  audioConfig: AudioConfig,
  callbacks: AzureRecognizerCallbacks,
) : AzureRecognizerEngine {

  private val recognizer = SpeechRecognizer(speechConfig, audioConfig)

  override val sdkRecognizer: Recognizer get() = recognizer

  init {
    recognizer.recognizing.addEventListener { _, args ->
      callbacks.azureRecognizing(args.result, speakerId = "")
    }
    recognizer.recognized.addEventListener { _, args ->
      callbacks.azureRecognized(args.result, speakerId = "")
    }
    recognizer.canceled.addEventListener { _, args ->
      callbacks.azureCanceled(args.reason, args.errorCode, args.errorDetails)
    }
    recognizer.sessionStopped.addEventListener { _, _ ->
      callbacks.azureSessionStopped()
    }
    recognizer.speechStartDetected.addEventListener { _, args ->
      val ms = args.offset.toDouble() / 10_000.0
      callbacks.azureSpeechBoundary("started", if (ms >= 0) ms else -1.0)
    }
    recognizer.speechEndDetected.addEventListener { _, args ->
      val ms = args.offset.toDouble() / 10_000.0
      callbacks.azureSpeechBoundary("ended", if (ms >= 0) ms else -1.0)
    }
  }

  override fun startAsync() = recognizer.startContinuousRecognitionAsync()
  override fun stopAsync() = recognizer.stopContinuousRecognitionAsync()
  override fun close() = recognizer.close()
  override fun updateAuthToken(token: String) = pokeAuthToken(recognizer, token)
}

// endregion

// region — Conversation transcriber wrapper (diarization)

internal class AzureConversationTranscriberEngineImpl(
  speechConfig: SpeechConfig,
  audioConfig: AudioConfig,
  callbacks: AzureRecognizerCallbacks,
) : AzureRecognizerEngine {

  private val transcriber = ConversationTranscriber(speechConfig, audioConfig)

  override val sdkRecognizer: Recognizer get() = transcriber

  init {
    transcriber.transcribing.addEventListener { _, args ->
      callbacks.azureRecognizing(args.result, speakerId = args.result.speakerId ?: "")
    }
    transcriber.transcribed.addEventListener { _, args ->
      callbacks.azureRecognized(args.result, speakerId = args.result.speakerId ?: "")
    }
    transcriber.canceled.addEventListener { _, args ->
      callbacks.azureCanceled(args.reason, args.errorCode, args.errorDetails)
    }
    transcriber.sessionStopped.addEventListener { _, _ ->
      callbacks.azureSessionStopped()
    }
    transcriber.speechStartDetected.addEventListener { _, args ->
      val ms = args.offset.toDouble() / 10_000.0
      callbacks.azureSpeechBoundary("started", if (ms >= 0) ms else -1.0)
    }
    transcriber.speechEndDetected.addEventListener { _, args ->
      val ms = args.offset.toDouble() / 10_000.0
      callbacks.azureSpeechBoundary("ended", if (ms >= 0) ms else -1.0)
    }
  }

  override fun startAsync() = transcriber.startTranscribingAsync()
  override fun stopAsync() = transcriber.stopTranscribingAsync()
  override fun close() = transcriber.close()
  override fun updateAuthToken(token: String) = pokeAuthToken(transcriber, token)
}

/**
 * Writes a fresh auth token into a recognizer's property bag. The SDK reads
 * the value on the next websocket reconnect, so this is a no-op for the
 * in-flight session — by design. Base [Recognizer] doesn't expose
 * `properties`; we narrow to the two concrete types we use.
 */
private fun pokeAuthToken(recognizer: Recognizer, token: String) {
  val props = when (recognizer) {
    is com.microsoft.cognitiveservices.speech.SpeechRecognizer -> recognizer.properties
    is com.microsoft.cognitiveservices.speech.transcription.ConversationTranscriber -> recognizer.properties
    else -> return
  }
  props.setProperty(
    com.microsoft.cognitiveservices.speech.PropertyId.SpeechServiceAuthorization_Token,
    token,
  )
}

// endregion
