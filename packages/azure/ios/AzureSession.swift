import AVFoundation
import Foundation
import MicrosoftCognitiveServicesSpeech

/// Drives an Azure SDK recognizer in continuous mode (speech-recognition by
/// default, conversation-transcriber when `config.enableSpeakerDiarization` is
/// true) and surfaces partials/finals/errors via `AzureCallbacks`.
/// Lifecycle: prepare → start → (events) → stop/discard → release.
internal final class AzureSession {
  private let config: AzureConfig
  private weak var callbacks: AzureCallbacks?

  private var speechConfig: SPXSpeechConfiguration?
  private var engine: AzureRecognizerEngine?
  private var audioMonitor: AudioSessionMonitor?

  /// Phrase finals accumulated during the session — stitched together on stop().
  private var accumulatedFinals: [String] = []
  /// Most recent partial — fallback when stop() lands before any final.
  private var latestPartial: String = ""

  private var sessionId: String = ""
  private var sessionStartMs: Double = 0

  /// True between start() and stop/discard/release.
  private var active: Bool = false
  /// While > Date.now, accept tail Recognized events that arrive after stop()
  /// returned, and emit them as additional 'final' callbacks. Lets the UI feel
  /// snappy on Stop while still surfacing any audio Azure was mid-processing.
  private var tailWindowEnd: Date?

  private var released: Bool = false

  /// How long after stop() we keep listening for tail Recognized events.
  private static let tailWindowSeconds: TimeInterval = 2.0

  init(config: AzureConfig, callbacks: AzureCallbacks) {
    self.config = config
    self.callbacks = callbacks
  }

  // MARK: Lifecycle

  func prepare() async throws {
    if released { throw AzureError(code: "ENGINE_NOT_READY", message: "Session was released") }

    try validateAuthConfig()
    try await ensureMicrophoneAuthorization()
    try configureAudioSession()
    installAudioMonitor()

    do {
      let cfg = try buildSpeechConfig()
      self.speechConfig = cfg

      // Wrap engine instantiation in an Obj-C @try/@catch — the SDK raises
      // raw NSException (not NSError) on init failures like requesting
      // diarization on a tier that doesn't include it. Without the catcher
      // those would crash the app instead of bubbling as a Clarion error.
      var built: AzureRecognizerEngine?
      var swiftError: Error?
      do {
        try AzureExceptionCatcher.run {
          do {
            built = self.config.enableSpeakerDiarization
              ? try AzureConversationTranscriberEngine(speechConfig: cfg, callbacks: self)
              : try AzureSpeechRecognizerEngine(speechConfig: cfg, callbacks: self)
          } catch {
            swiftError = error
          }
        }
      } catch {
        // Diarization fallback: if degradeOnTierMismatch is on, try a regular
        // speech recognizer instead, and emit a DEGRADED_MODE warning.
        if self.config.enableSpeakerDiarization && self.config.degradeOnTierMismatch {
          NSLog("[ClarionAzure] Diarization init failed; falling back to non-diarization.")
          do {
            built = try AzureSpeechRecognizerEngine(speechConfig: cfg, callbacks: self)
            self.callbacks?.onError(AzureError(
              code: "INTERNAL_ERROR",
              message: "Diarization unavailable on this Azure tier — fell back to non-diarization recognition. (DEGRADED_MODE)",
              recoverable: false
            ))
          } catch {
            throw mapEngineInitError(error as NSError)
          }
        } else {
          throw mapEngineInitError(error as NSError)
        }
      }
      if let swiftError = swiftError {
        throw AzureErrorMapping.map(swiftError)
      }
      guard let engine = built else {
        throw AzureError(code: "INTERNAL_ERROR", message: "Failed to initialize Azure recognizer")
      }
      self.engine = engine

      // Install custom-vocab phrase hints (no-op if list is empty).
      installPhraseHints()

      // NOTE: Pre-warming via SPXConnection.open() was attempted here, but the
      // Microsoft Speech SDK can raise SIGTRAP (C++ abort, not NSException) on
      // some configurations — and SIGTRAP cannot be caught by Obj-C @try/@catch
      // or Swift `try`. The first `start()` carries the ~500-1000 ms handshake
      // instead, which is acceptable. If the SDK exposes a safe pre-warm hook
      // in a future version, revisit.
    } catch let azureErr as AzureError {
      throw azureErr
    } catch {
      throw AzureErrorMapping.map(error)
    }
  }

  /// Maps an engine-init NSError (from the Obj-C catcher) into a friendly
  /// AzureError. Special-cases the common diarization-tier-mismatch.
  private func mapEngineInitError(_ err: NSError) -> AzureError {
    let reason = err.localizedDescription
    if config.enableSpeakerDiarization {
      return AzureError(
        code: "UNSUPPORTED_FORMAT",
        message: "Failed to initialize Azure conversation transcriber for diarization. "
          + "This feature requires the S0 (Standard) Speech tier and an en-US locale. "
          + "Underlying error: \(reason)"
      )
    }
    return AzureError(
      code: "INTERNAL_ERROR",
      message: "Failed to initialize Azure recognizer: \(reason)"
    )
  }

  func start() throws {
    if released { throw AzureError(code: "ENGINE_NOT_READY", message: "Session was released") }
    guard let engine = engine else {
      throw AzureError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
    }

    accumulatedFinals.removeAll()
    latestPartial = ""
    sessionId = UUID().uuidString
    sessionStartMs = Date().timeIntervalSince1970 * 1_000
    tailWindowEnd = nil  // close any prior tail window — we're a new session

    do {
      try engine.start()
    } catch {
      throw AzureErrorMapping.map(error)
    }

    active = true
    callbacks?.onState("recording")
  }

  /// Optimistic stop: resolves immediately with the stitched session-final, then
  /// keeps the recognizer alive for `tailWindowSeconds` so any tail Recognized
  /// events Azure emits during its buffer flush surface as additional 'final'
  /// callbacks (the app can update its UI with the more-complete transcript).
  func stop() throws -> AzureTranscript {
    if released { throw AzureError(code: "ENGINE_NOT_READY", message: "Session was released") }
    guard let engine = engine else {
      throw AzureError(code: "ENGINE_NOT_READY", message: "No active recognition")
    }

    active = false
    tailWindowEnd = Date().addingTimeInterval(AzureSession.tailWindowSeconds)
    callbacks?.onState("stopping")

    // Kick off the SDK stop — don't await. The recognizer will fire any tail
    // Recognized events on the listener thread; sessionStopped lands a moment
    // later and we'll observe it via azureSessionStopped().
    do {
      try engine.stop()
    } catch {
      // Don't fail stop() on SDK quirks during flush — we're resolving optimistically.
      // The error will surface (if real) via the `canceled` event handler.
    }

    let optimisticFinal = buildSessionFinal()
    callbacks?.onState("idle")
    return optimisticFinal
  }

  func discard() {
    active = false
    tailWindowEnd = nil
    if let engine = engine {
      try? engine.stop()
    }
    callbacks?.onState("idle")
  }

  /// Hot-swap the auth token on the currently-active session. The Azure SDK
  /// reads the token off the SPXRecognizer.properties bag on the next
  /// reconnect; the in-flight session is unaffected.
  func updateAuthToken(_ token: String) {
    speechConfig?.authorizationToken = token
    // Propagate to the live recognizer's property bag so the swap takes effect
    // on the next websocket reconnect. The base `SPXRecognizer` exposes
    // `properties` even though it doesn't have a direct `authorizationToken`
    // accessor like the subclasses do.
    engine?.spxBase.properties?.setPropertyTo?(token, by: .speechServiceAuthorizationToken)
  }

  func release() async {
    if released { return }
    released = true
    discard()
    engine = nil
    speechConfig = nil
    audioMonitor = nil  // observers cleaned up in deinit
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    callbacks?.onState("released")
  }

  /// Listens for AVAudioSession interruption + route change events so we can
  /// surface them as clean ClarionErrors instead of leaving the session in an
  /// inconsistent state. The monitor calls back on the main queue.
  private func installAudioMonitor() {
    audioMonitor = AudioSessionMonitor(
      onInterruptionBegan: { [weak self] in
        guard let self, self.active else { return }
        self.callbacks?.onError(AzureError(
          code: "AUDIO_SESSION_INTERRUPTED",
          message: "Audio session interrupted by another app (phone call, Siri, etc.).",
          recoverable: true
        ))
        // Don't auto-discard — leave it to the JS layer to decide whether to
        // call stop() or wait for .ended and resume.
      },
      onInterruptionEnded: { [weak self] _ in
        // Caller can decide to resume by calling start() again. We don't
        // auto-resume because the audio engine state is uncertain.
        _ = self
      },
      onRouteChanged: { [weak self] reason in
        guard let self, self.active else { return }
        // Only surface meaningful route changes; ignore .categoryChange noise.
        switch reason {
        case .oldDeviceUnavailable, .newDeviceAvailable, .override:
          self.callbacks?.onError(AzureError(
            code: "AUDIO_ROUTE_CHANGED",
            message: "Audio route changed (reason \(reason.rawValue)).",
            recoverable: true
          ))
        default:
          return
        }
      }
    )
  }

  // MARK: Helpers

  /// Returns true if we should still surface a result, based on session state
  /// + tail window. Closes the tail window when it expires.
  private func acceptingEvents() -> Bool {
    if active { return true }
    if let deadline = tailWindowEnd, Date() < deadline {
      return true
    }
    tailWindowEnd = nil
    return false
  }

  private func buildSessionFinal() -> AzureTranscript {
    let text: String
    if !accumulatedFinals.isEmpty {
      text = accumulatedFinals.joined(separator: " ")
    } else {
      text = latestPartial
    }
    return AzureTranscriptBuilder.fromText(
      text,
      isFinal: true,
      sessionId: sessionId,
      sessionStartMs: sessionStartMs,
      language: config.language
    )
  }

  // MARK: Setup

  private func validateAuthConfig() throws {
    let hasKey = !config.subscriptionKey.isEmpty && !config.region.isEmpty
    let hasToken = !config.authToken.isEmpty && !config.region.isEmpty
    let hasEndpoint = !config.endpoint.isEmpty
    if !(hasKey || hasToken || hasEndpoint) {
      throw AzureError(
        code: "INVALID_STATE",
        message: "Azure config needs one of: subscriptionKey+region, authToken+region, or endpoint."
      )
    }
  }

  private func buildSpeechConfig() throws -> SPXSpeechConfiguration {
    let cfg: SPXSpeechConfiguration
    if !config.endpoint.isEmpty {
      guard let endpointCfg = try? SPXSpeechConfiguration(endpoint: config.endpoint) else {
        throw AzureError(code: "INVALID_STATE", message: "Failed to build SPXSpeechConfiguration from endpoint.")
      }
      cfg = endpointCfg
      if !config.subscriptionKey.isEmpty {
        cfg.setPropertyTo(config.subscriptionKey, by: .speechServiceConnectionKey)
      }
      if !config.authToken.isEmpty {
        cfg.authorizationToken = config.authToken
      }
    } else if !config.authToken.isEmpty {
      guard let tokenCfg = try? SPXSpeechConfiguration(authorizationToken: config.authToken, region: config.region) else {
        throw AzureError(code: "AUTH_FAILED", message: "Failed to build SPXSpeechConfiguration from auth token.")
      }
      cfg = tokenCfg
    } else {
      guard let keyCfg = try? SPXSpeechConfiguration(subscription: config.subscriptionKey, region: config.region) else {
        throw AzureError(code: "AUTH_FAILED", message: "Failed to build SPXSpeechConfiguration from subscription key.")
      }
      cfg = keyCfg
    }

    cfg.speechRecognitionLanguage = config.language

    // Profanity policy.
    switch config.profanity.lowercased() {
    case "removed": cfg.setProfanityOptionTo(SPXSpeechConfigProfanityOption.profanityRemoved)
    case "raw":     cfg.setProfanityOptionTo(SPXSpeechConfigProfanityOption.profanityRaw)
    case "none":    cfg.setProfanityOptionTo(SPXSpeechConfigProfanityOption.profanityRaw)
    default:        cfg.setProfanityOptionTo(SPXSpeechConfigProfanityOption.profanityMasked)
    }

    if config.outputFormat.lowercased() == "detailed" {
      cfg.outputFormat = .detailed
      cfg.requestWordLevelTimestamps()
    }

    // Silence-detection: auto-stop after N ms of silence (server-side VAD).
    // Property API used because the typed Swift property doesn't exist in
    // the iOS SDK — only the constant string identifier is reliable.
    if config.silenceTimeoutMs > 0 {
      cfg.setPropertyTo(
        "\(Int(config.silenceTimeoutMs))",
        by: .speechServiceConnectionEndSilenceTimeoutMs
      )
    }

    return cfg
  }

  /// Install phrase-list grammar on the recognizer if any hints were supplied.
  /// Must be called AFTER the recognizer instance exists, since the grammar
  /// is created from the recognizer, not the speech config.
  private func installPhraseHints() {
    guard !config.phraseHints.isEmpty, let engine = engine else { return }
    guard let grammar = SPXPhraseListGrammar(recognizer: engine.spxBase) else { return }
    for phrase in config.phraseHints where !phrase.isEmpty {
      grammar.addPhrase(phrase)
    }
  }

  // MARK: Audio session + permissions

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.duckOthers]
    if #available(iOS 18.0, *) {
      options.insert(.allowBluetoothHFP)
    } else {
      options.insert(.allowBluetooth)
    }
    do {
      try session.setCategory(.playAndRecord, mode: .measurement, options: options)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      throw AzureError(code: "AUDIO_BUSY", message: "Failed to activate audio session: \(error.localizedDescription)")
    }
  }

  private func ensureMicrophoneAuthorization() async throws {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return
      case .denied:
        throw AzureError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      default:
        let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
          AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        if !granted {
          throw AzureError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
        }
      }
      return
    }
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted: return
    case .denied:
      throw AzureError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
    default:
      let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        session.requestRecordPermission { cont.resume(returning: $0) }
      }
      if !granted {
        throw AzureError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      }
    }
  }
}

// MARK: - AzureRecognizerCallbacks

extension AzureSession: AzureRecognizerCallbacks {
  func azureRecognizing(result: SPXRecognitionResult, speakerId: String) {
    if !active { return }  // Don't emit partials in the tail window.
    let transcript = AzureTranscriptBuilder.from(
      result: result,
      isFinal: false,
      sessionId: sessionId,
      sessionStartMs: sessionStartMs,
      fallbackLanguage: config.language,
      speakerId: speakerId
    )
    latestPartial = transcript.text
    if config.emitPartials {
      callbacks?.onPartial(transcript)
    }
  }

  func azureRecognized(result: SPXRecognitionResult, speakerId: String) {
    if !acceptingEvents() { return }
    guard result.reason == .recognizedSpeech else { return }
    let transcript = AzureTranscriptBuilder.from(
      result: result,
      isFinal: true,
      sessionId: sessionId,
      sessionStartMs: sessionStartMs,
      fallbackLanguage: config.language,
      speakerId: speakerId
    )
    if !transcript.text.isEmpty {
      accumulatedFinals.append(transcript.text)
    }
    callbacks?.onFinal(transcript)
  }

  func azureCanceled(
    reason: SPXCancellationReason,
    errorCode: SPXCancellationErrorCode,
    errorDetails: String?
  ) {
    // Graceful stop = end of stream. Not an error.
    if reason == .endOfStream { return }
    // Tail event after stop window closed — drop silently.
    if !acceptingEvents() { return }

    let mapped = AzureErrorMapping.map(
      reason: reason,
      errorCode: errorCode,
      errorDetails: errorDetails
    )
    callbacks?.onError(mapped)
  }

  func azureSessionStopped() {
    // Close the tail window — recognizer has finished flushing.
    tailWindowEnd = nil
  }

  func azureSpeechBoundary(kind: String, offsetMs: Double) {
    if !active { return }
    callbacks?.onSpeechBoundary(kind: kind, offsetMs: offsetMs)
  }
}
