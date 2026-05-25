import Foundation
import MicrosoftCognitiveServicesSpeech

/// Receives normalized events from either `SPXSpeechRecognizer` or
/// `SPXConversationTranscriber` so `AzureSession` can stay engine-agnostic.
internal protocol AzureRecognizerCallbacks: AnyObject {
  func azureRecognizing(result: SPXRecognitionResult, speakerId: String)
  func azureRecognized(result: SPXRecognitionResult, speakerId: String)
  func azureCanceled(
    reason: SPXCancellationReason,
    errorCode: SPXCancellationErrorCode,
    errorDetails: String?
  )
  func azureSessionStopped()
  /// `kind` = "started" or "ended", `offsetMs` in ms since session start (-1 if unknown).
  func azureSpeechBoundary(kind: String, offsetMs: Double)
}

/// Internal-only abstraction over the two Azure recognizer flavors.
/// Both wrappers expose the same lifecycle so `AzureSession` doesn't have to
/// branch on diarization in every method.
internal protocol AzureRecognizerEngine: AnyObject {
  /// The underlying SPX recognizer instance — exposed so callers can reach
  /// its `properties` bag (e.g. to hot-swap the auth token between sessions).
  var spxBase: SPXRecognizer { get }
  func start() throws
  func stop() throws
}

// MARK: - Speech-recognition wrapper (no diarization)

internal final class AzureSpeechRecognizerEngine: AzureRecognizerEngine {
  private let recognizer: SPXSpeechRecognizer
  private weak var callbacks: AzureRecognizerCallbacks?

  var spxBase: SPXRecognizer { recognizer }

  init(speechConfig: SPXSpeechConfiguration, callbacks: AzureRecognizerCallbacks) throws {
    self.recognizer = try SPXSpeechRecognizer(speechConfig)
    self.callbacks = callbacks
    bindHandlers()
  }

  func start() throws { try recognizer.startContinuousRecognition() }
  func stop() throws { try recognizer.stopContinuousRecognition() }

  private func bindHandlers() {
    recognizer.addRecognizingEventHandler { [weak self] _, args in
      self?.callbacks?.azureRecognizing(result: args.result, speakerId: "")
    }
    recognizer.addRecognizedEventHandler { [weak self] _, args in
      self?.callbacks?.azureRecognized(result: args.result, speakerId: "")
    }
    recognizer.addCanceledEventHandler { [weak self] _, args in
      self?.callbacks?.azureCanceled(
        reason: args.reason,
        errorCode: args.errorCode,
        errorDetails: args.errorDetails
      )
    }
    recognizer.addSessionStoppedEventHandler { [weak self] _, _ in
      self?.callbacks?.azureSessionStopped()
    }
    recognizer.addSpeechStartDetectedEventHandler { [weak self] _, args in
      let offsetMs = Double(args.offset) / 10_000.0
      self?.callbacks?.azureSpeechBoundary(kind: "started", offsetMs: offsetMs >= 0 ? offsetMs : -1)
    }
    recognizer.addSpeechEndDetectedEventHandler { [weak self] _, args in
      let offsetMs = Double(args.offset) / 10_000.0
      self?.callbacks?.azureSpeechBoundary(kind: "ended", offsetMs: offsetMs >= 0 ? offsetMs : -1)
    }
  }
}

// MARK: - Conversation-transcriber wrapper (diarization)

internal final class AzureConversationTranscriberEngine: AzureRecognizerEngine {
  private let transcriber: SPXConversationTranscriber
  private weak var callbacks: AzureRecognizerCallbacks?

  var spxBase: SPXRecognizer { transcriber }

  init(speechConfig: SPXSpeechConfiguration, callbacks: AzureRecognizerCallbacks) throws {
    // SPXConversationTranscriber requires an explicit audio configuration —
    // it doesn't have a default-mic-only init.
    let audioConfig = SPXAudioConfiguration()
    self.transcriber = try SPXConversationTranscriber(
      speechConfiguration: speechConfig,
      audioConfiguration: audioConfig
    )
    self.callbacks = callbacks
    bindHandlers()
  }

  // The Async-suffixed methods take a `(Bool, Error?) -> Void` completion
  // block — we don't need to know when start/stop finishes since events flow
  // on the listener anyway. Just log unexpected errors.
  func start() throws {
    try transcriber.startTranscribingAsync { ok, err in
      if !ok, let err = err { NSLog("[ClarionAzure] startTranscribingAsync failed: \(err)") }
    }
  }
  func stop() throws {
    try transcriber.stopTranscribingAsync { ok, err in
      if !ok, let err = err { NSLog("[ClarionAzure] stopTranscribingAsync failed: \(err)") }
    }
  }

  private func bindHandlers() {
    transcriber.addTranscribingEventHandler { [weak self] _, args in
      guard let result = args.result else { return }
      self?.callbacks?.azureRecognizing(
        result: result,
        speakerId: result.speakerId ?? ""
      )
    }
    transcriber.addTranscribedEventHandler { [weak self] _, args in
      guard let result = args.result else { return }
      self?.callbacks?.azureRecognized(
        result: result,
        speakerId: result.speakerId ?? ""
      )
    }
    transcriber.addCanceledEventHandler { [weak self] _, args in
      self?.callbacks?.azureCanceled(
        reason: args.reason,
        errorCode: args.errorCode,
        errorDetails: args.errorDetails
      )
    }
    transcriber.addSessionStoppedEventHandler { [weak self] _, _ in
      self?.callbacks?.azureSessionStopped()
    }
    transcriber.addSpeechStartDetectedEventHandler { [weak self] _, args in
      let offsetMs = Double(args.offset) / 10_000.0
      self?.callbacks?.azureSpeechBoundary(kind: "started", offsetMs: offsetMs >= 0 ? offsetMs : -1)
    }
    transcriber.addSpeechEndDetectedEventHandler { [weak self] _, args in
      let offsetMs = Double(args.offset) / 10_000.0
      self?.callbacks?.azureSpeechBoundary(kind: "ended", offsetMs: offsetMs >= 0 ? offsetMs : -1)
    }
  }
}
