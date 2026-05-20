import AVFoundation
import Foundation
import Speech

/// Drives SFSpeechRecognizer + AVAudioEngine and surfaces partials/finals/errors
/// to the bridge via `RecognizerCallbacks`. Matches the lifecycle of the Android
/// RecognizerSession: prepare → start → (partial events) → stop/discard → release.
internal final class RecognizerSession {
  private let config: RecognizerConfig
  private weak var callbacks: RecognizerCallbacks?

  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  private let audioEngine = AVAudioEngine()

  /// Resumed by the recognition task callback when stop() is awaiting a final.
  private var stopContinuation: CheckedContinuation<RecognizerTranscript, Error>?
  /// Last partial we observed — used to seed the final if SFSpeech goes silent
  /// after endAudio() without firing a final result.
  private var latestPartial: String = ""

  /// UUID of the current start→stop cycle. Re-generated on every `start()`.
  private var sessionId: String = ""
  /// Wall-clock ms at the start of the current session. Used for `offsetMs`.
  private var sessionStartMs: Double = 0

  private var lastLevelEmitMs: Double = 0
  private var released: Bool = false

  /// True between start() and stop/discard/release. Used to drop tail callbacks
  /// SFSpeech sometimes fires after we've ended the session (cancel errors,
  /// late results, etc.) so they don't surface as spurious errors.
  private var active: Bool = false

  init(config: RecognizerConfig, callbacks: RecognizerCallbacks) {
    self.config = config
    self.callbacks = callbacks
  }

  // MARK: Lifecycle

  func prepare() async throws {
    if released { throw RecognizerError(code: "ENGINE_NOT_READY", message: "Session was released") }

    try await ensureAuthorizations()

    let locale = Locale(identifier: config.language)
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
      throw RecognizerError(
        code: "UNSUPPORTED_LANGUAGE",
        message: "No SFSpeechRecognizer for locale '\(config.language)'"
      )
    }
    guard recognizer.isAvailable else {
      throw RecognizerError(
        code: "ENGINE_NOT_READY",
        message: "SFSpeechRecognizer is not available for '\(config.language)' right now",
        recoverable: true
      )
    }
    self.recognizer = recognizer
    try configureAudioSession()
  }

  func start() throws {
    if released { throw RecognizerError(code: "ENGINE_NOT_READY", message: "Session was released") }
    guard let recognizer = recognizer else {
      throw RecognizerError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
    }

    latestPartial = ""
    sessionId = UUID().uuidString
    sessionStartMs = Date().timeIntervalSince1970 * 1_000

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = config.emitPartials
    if config.preferOnDevice {
      if recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
      }
      // If the recognizer doesn't support on-device, we silently fall back to
      // server-side; the JS option is a preference, not a hard requirement.
    }
    self.request = request

    let inputNode = audioEngine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)
    let bufferSize: AVAudioFrameCount = 1024

    // Remove any pre-existing tap from a previous session before installing.
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
      guard let self else { return }
      self.handle(inputBuffer: buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      self.handleRecognition(result: result, error: error)
    }

    active = true
    callbacks?.onState("recording")
  }

  func stop() async throws -> RecognizerTranscript {
    if released { throw RecognizerError(code: "ENGINE_NOT_READY", message: "Session was released") }
    guard request != nil, task != nil else {
      throw RecognizerError(code: "ENGINE_NOT_READY", message: "No active recognition")
    }
    active = false
    callbacks?.onState("stopping")

    // Stop feeding audio. The recognizer will deliver the final result via the
    // recognitionTask callback shortly after.
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()
    request?.endAudio()

    let transcript: RecognizerTranscript = try await withCheckedThrowingContinuation { cont in
      self.stopContinuation = cont
      // 8-second fallback in case SFSpeech never resolves (e.g. silent input
      // on certain locales just times out internally).
      DispatchQueue.global().asyncAfter(deadline: .now() + 8.0) { [weak self] in
        guard let self else { return }
        if let pending = self.stopContinuation {
          self.stopContinuation = nil
          pending.resume(returning: TranscriptBuilder.from(
            text: self.latestPartial,
            isFinal: true,
            sessionId: self.sessionId,
            sessionStartMs: self.sessionStartMs,
            language: self.config.language
          ))
        }
      }
    }

    request = nil
    task = nil
    callbacks?.onState("idle")
    return transcript
  }

  func discard() async {
    active = false
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()
    task?.cancel()
    request = nil
    task = nil

    // Resolve a pending stop with the latest partial — same shape as Android.
    // Throwing through the continuation surfaces as INTERNAL_ERROR with a JNI/
    // bridge wrapper message; better to return empty/partial cleanly.
    if let cont = stopContinuation {
      stopContinuation = nil
      cont.resume(returning: TranscriptBuilder.from(
        text: latestPartial,
        isFinal: true,
        sessionId: sessionId,
        sessionStartMs: sessionStartMs,
        language: config.language
      ))
    }
    callbacks?.onState("idle")
  }

  func release() async {
    if released { return }
    released = true
    await discard()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    recognizer = nil
    callbacks?.onState("released")
  }

  // MARK: Internal

  private func handle(inputBuffer: AVAudioPCMBuffer) {
    request?.append(inputBuffer)
    if config.emitAudioLevel { maybeEmitLevels(inputBuffer) }
  }

  private func maybeEmitLevels(_ buffer: AVAudioPCMBuffer) {
    let now = nowMs()
    if now - lastLevelEmitMs < config.audioLevelIntervalMs { return }
    lastLevelEmitMs = now
    let levels = AudioLevelMeter.compute(buffer: buffer)
    callbacks?.onAudioLevel(rms: levels.rms, peak: levels.peak)
  }

  private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
    // Drop tail callbacks fired after the session ended (cancel errors,
    // late finals from a stopped task, etc.) unless stop() is still waiting.
    if !active && stopContinuation == nil { return }

    if let error = error {
      let mapped = mapAuthError(error)
      // ERROR_NO_MATCH-style "kAFAssistantErrorDomain code=1110 / 203" after
      // endAudio() means "stopped, nothing recognized." Resolve the pending
      // stop continuation with the last partial rather than surfacing an error.
      if let cont = stopContinuation, mapped.code == "NO_SPEECH" {
        stopContinuation = nil
        cont.resume(returning: TranscriptBuilder.from(
          text: latestPartial,
          isFinal: true,
          sessionId: sessionId,
          sessionStartMs: sessionStartMs,
          language: config.language
        ))
        return
      }
      callbacks?.onError(mapped)
      if let cont = stopContinuation {
        stopContinuation = nil
        cont.resume(returning: TranscriptBuilder.from(
          text: latestPartial,
          isFinal: true,
          sessionId: sessionId,
          sessionStartMs: sessionStartMs,
          language: config.language
        ))
      }
      return
    }

    guard let result = result else { return }
    let transcript = TranscriptBuilder.from(
      result: result,
      sessionId: sessionId,
      sessionStartMs: sessionStartMs,
      language: config.language
    )

    if result.isFinal {
      if let cont = stopContinuation {
        // stop() is awaiting — resolve the continuation. Bridge will emit
        // 'final' via the stop() promise; don't double-emit here.
        stopContinuation = nil
        cont.resume(returning: transcript)
      } else {
        callbacks?.onFinal(transcript)
        callbacks?.onState("idle")
      }
    } else {
      latestPartial = transcript.text
      if config.emitPartials {
        callbacks?.onPartial(transcript)
      }
    }
  }

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    // .measurement disables system processing (AGC, noise suppression) that
    // can confuse SFSpeechRecognizer.
    var options: AVAudioSession.CategoryOptions = [.duckOthers]
    if #available(iOS 18.0, *) {
      options.insert(.allowBluetoothHFP)
    } else {
      options.insert(.allowBluetooth)
    }
    try session.setCategory(.playAndRecord, mode: .measurement, options: options)
    try session.setActive(true, options: .notifyOthersOnDeactivation)
  }

  private func ensureAuthorizations() async throws {
    try await ensureSpeechAuthorization()
    try await ensureMicrophoneAuthorization()
  }

  private func ensureSpeechAuthorization() async throws {
    let current = SFSpeechRecognizer.authorizationStatus()
    switch current {
    case .authorized:
      return
    case .denied, .restricted:
      throw RecognizerError(
        code: "PERMISSION_DENIED",
        message: "Speech recognition permission denied"
      )
    case .notDetermined:
      let granted: SFSpeechRecognizerAuthorizationStatus =
        await withCheckedContinuation { cont in
          SFSpeechRecognizer.requestAuthorization { status in
            cont.resume(returning: status)
          }
        }
      if granted != .authorized {
        throw RecognizerError(
          code: "PERMISSION_DENIED",
          message: "Speech recognition permission denied"
        )
      }
    @unknown default:
      throw RecognizerError(
        code: "PERMISSION_DENIED",
        message: "Unknown speech recognition authorization status"
      )
    }
  }

  private func ensureMicrophoneAuthorization() async throws {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted:
        return
      case .denied:
        throw RecognizerError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      default:
        let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
          AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        if !granted {
          throw RecognizerError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
        }
      }
      return
    }
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted:
      return
    case .denied:
      throw RecognizerError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
    default:
      let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        session.requestRecordPermission { cont.resume(returning: $0) }
      }
      if !granted {
        throw RecognizerError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      }
    }
  }

  /// Maps an SFSpeechRecognitionTask error (NSError in `kAFAssistantErrorDomain`,
  /// `kLSRErrorDomain`, `NSCocoaErrorDomain`, or `NSURLErrorDomain`) to our
  /// internal `ClarionError` code surface.
  private func mapAuthError(_ error: Error) -> RecognizerError {
    let ns = error as NSError
    // Codes 1110 / 203 / 216 / 1700 are SFSpeech "no speech detected" variants.
    let noSpeechCodes: Set<Int> = [203, 216, 1110, 1700]
    if noSpeechCodes.contains(ns.code) {
      return RecognizerError(code: "NO_SPEECH", message: "No speech detected", recoverable: true)
    }
    // kLSRErrorDomain = Local Speech Recognition failures. Code 300 means
    // "no model installed for this locale" — recoverable by downloading the
    // language pack in iOS Settings or picking a different locale.
    if ns.domain == "kLSRErrorDomain" {
      return RecognizerError(
        code: "UNSUPPORTED_LANGUAGE",
        message: "Local speech model unavailable for '\(config.language)'. Add the language under iOS Settings → General → Keyboard → Dictation.",
        recoverable: true
      )
    }
    // Network errors during server-side recognition.
    if ns.domain == NSURLErrorDomain {
      return RecognizerError(
        code: "NETWORK_UNAVAILABLE",
        message: ns.localizedDescription,
        recoverable: true
      )
    }
    return RecognizerError(
      code: "INTERNAL_ERROR",
      message: "SFSpeechRecognizer error: \(ns.localizedDescription) (\(ns.domain) \(ns.code))"
    )
  }

  private func nowMs() -> Double {
    return Date().timeIntervalSince1970 * 1_000
  }
}
