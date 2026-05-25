import Foundation
import MicrosoftCognitiveServicesSpeech
import NitroModules

public typealias AzureStateClosure = (String) -> Void
public typealias AzureAudioLevelClosure = (Double, Double) -> Void
public typealias AzureTranscriptClosure = (NativeTranscriptResult) -> Void
public typealias AzureErrorClosure = (NativeAzureError) -> Void
public typealias AzureSpeechBoundaryClosure = (String, Double) -> Void

public final class HybridClarionAzure: HybridClarionAzureSpec {
  private var session: AzureSession?
  private var currentStateValue: String = "idle"

  private var nextListenerId: Int = 1
  private var stateListeners: [Int: AzureStateClosure] = [:]
  private var audioLevelListeners: [Int: AzureAudioLevelClosure] = [:]
  private var partialListeners: [Int: AzureTranscriptClosure] = [:]
  private var finalListeners: [Int: AzureTranscriptClosure] = [:]
  private var errorListeners: [Int: AzureErrorClosure] = [:]
  private var speechBoundaryListeners: [Int: AzureSpeechBoundaryClosure] = [:]

  private let listenerLock = NSLock()

  public var state: String { currentStateValue }

  public func isAvailable(config: NativeAzureConfig) throws -> Promise<Bool> {
    return Promise.async {
      let parsed = config.toSwiftConfig()
      // Best-effort: try to build a speech config with the supplied auth.
      // Real auth failures will surface at start() — this is just a smoke probe.
      let hasKey = !parsed.subscriptionKey.isEmpty && !parsed.region.isEmpty
      let hasToken = !parsed.authToken.isEmpty && !parsed.region.isEmpty
      let hasEndpoint = !parsed.endpoint.isEmpty
      guard hasKey || hasToken || hasEndpoint else { return false }

      do {
        if !parsed.endpoint.isEmpty {
          _ = try SPXSpeechConfiguration(endpoint: parsed.endpoint)
        } else if !parsed.authToken.isEmpty {
          _ = try SPXSpeechConfiguration(authorizationToken: parsed.authToken, region: parsed.region)
        } else {
          _ = try SPXSpeechConfiguration(subscription: parsed.subscriptionKey, region: parsed.region)
        }
        return true
      } catch {
        return false
      }
    }
  }

  public func prepare(config: NativeAzureConfig) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      let parsed = config.toSwiftConfig()
      let newSession = AzureSession(config: parsed, callbacks: self)
      self.emit(state: "preparing")
      try await newSession.prepare()
      self.session = newSession
      self.emit(state: "ready")
    }
  }

  public func start() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      guard let session = self.session else {
        throw AzureError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
      }
      self.emit(state: "starting")
      try session.start()
    }
  }

  public func stop() throws -> Promise<NativeTranscriptResult> {
    return Promise.async { [weak self] in
      guard let self, let session = self.session else {
        throw AzureError(code: "ENGINE_NOT_READY", message: "No session")
      }
      // session.stop() is optimistic — returns immediately with the stitched
      // session-final; any tail recognized phrases land on the listener.
      let result = try session.stop()
      return result.toNative()
    }
  }

  public func discard() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      self?.session?.discard()
    }
  }

  public func release() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      await self.session?.release()
      self.session = nil
      self.removeAllListeners()
    }
  }

  public func updateAuthToken(token: String) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      // Forward to the active session if one exists; otherwise no-op.
      // The next prepare() will pick up the new token from config.
      self.session?.updateAuthToken(token)
    }
  }

  public func addStateListener(listener: @escaping AzureStateClosure) throws -> Double {
    register { id in stateListeners[id] = listener }
  }

  public func addAudioLevelListener(listener: @escaping AzureAudioLevelClosure) throws -> Double {
    register { id in audioLevelListeners[id] = listener }
  }

  public func addPartialListener(listener: @escaping AzureTranscriptClosure) throws -> Double {
    register { id in partialListeners[id] = listener }
  }

  public func addFinalListener(listener: @escaping AzureTranscriptClosure) throws -> Double {
    register { id in finalListeners[id] = listener }
  }

  public func addErrorListener(listener: @escaping AzureErrorClosure) throws -> Double {
    register { id in errorListeners[id] = listener }
  }

  public func addSpeechBoundaryListener(listener: @escaping AzureSpeechBoundaryClosure) throws -> Double {
    register { id in speechBoundaryListeners[id] = listener }
  }

  public func removeListener(id: Double) throws {
    listenerLock.lock(); defer { listenerLock.unlock() }
    let key = Int(id)
    stateListeners.removeValue(forKey: key)
    audioLevelListeners.removeValue(forKey: key)
    partialListeners.removeValue(forKey: key)
    finalListeners.removeValue(forKey: key)
    errorListeners.removeValue(forKey: key)
    speechBoundaryListeners.removeValue(forKey: key)
  }

  public func removeAllListeners() {
    listenerLock.lock(); defer { listenerLock.unlock() }
    stateListeners.removeAll()
    audioLevelListeners.removeAll()
    partialListeners.removeAll()
    finalListeners.removeAll()
    errorListeners.removeAll()
    speechBoundaryListeners.removeAll()
  }

  private func register(_ assign: (Int) -> Void) -> Double {
    listenerLock.lock(); defer { listenerLock.unlock() }
    let id = nextListenerId
    nextListenerId += 1
    assign(id)
    return Double(id)
  }

  private func emit(state: String) {
    currentStateValue = state
    snapshotListeners(stateListeners).forEach { $0(state) }
  }

  private func snapshotListeners<T>(_ map: [Int: T]) -> [T] {
    listenerLock.lock(); defer { listenerLock.unlock() }
    return Array(map.values)
  }
}

extension HybridClarionAzure: AzureCallbacks {
  func onState(_ state: String) {
    emit(state: state)
  }

  func onAudioLevel(rms: Double, peak: Double) {
    snapshotListeners(audioLevelListeners).forEach { $0(rms, peak) }
  }

  func onPartial(_ transcript: AzureTranscript) {
    let payload = transcript.toNative()
    snapshotListeners(partialListeners).forEach { $0(payload) }
  }

  func onFinal(_ transcript: AzureTranscript) {
    let payload = transcript.toNative()
    snapshotListeners(finalListeners).forEach { $0(payload) }
  }

  func onError(_ error: AzureError) {
    currentStateValue = "error"
    let payload = NativeAzureError(
      code: error.code,
      message: error.message,
      recoverable: error.recoverable
    )
    snapshotListeners(errorListeners).forEach { $0(payload) }
  }

  func onSpeechBoundary(kind: String, offsetMs: Double) {
    snapshotListeners(speechBoundaryListeners).forEach { $0(kind, offsetMs) }
  }
}

private extension NativeAzureConfig {
  func toSwiftConfig() -> AzureConfig {
    let langs: [String]
    if autoDetectLanguages.isEmpty {
      langs = []
    } else {
      langs = autoDetectLanguages
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    }
    let phrases: [String]
    if phraseHints.isEmpty {
      phrases = []
    } else {
      phrases = phraseHints
        .split(separator: "\n", omittingEmptySubsequences: true)
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    }
    return AzureConfig(
      language: language,
      emitPartials: emitPartials,
      emitAudioLevel: emitAudioLevel,
      audioLevelIntervalMs: audioLevelIntervalMs,
      subscriptionKey: subscriptionKey,
      region: region,
      authToken: authToken,
      endpoint: endpoint,
      outputFormat: outputFormat,
      profanity: profanity,
      enableSpeakerDiarization: enableSpeakerDiarization,
      autoDetectLanguages: langs,
      silenceTimeoutMs: silenceTimeoutMs,
      phraseHints: phrases,
      degradeOnTierMismatch: degradeOnTierMismatch
    )
  }
}

private extension AzureSegment {
  func toNative() -> NativeTranscriptSegment {
    return NativeTranscriptSegment(
      text: text,
      startMs: startMs,
      durationMs: durationMs,
      confidence: confidence,
      alternatives: alternatives
    )
  }
}

private extension AzureTranscript {
  func toNative() -> NativeTranscriptResult {
    return NativeTranscriptResult(
      id: id,
      sessionId: sessionId,
      timestamp: timestamp,
      text: text,
      isFinal: isFinal,
      language: language,
      confidence: confidence,
      offsetMs: offsetMs,
      durationMs: durationMs,
      speakerId: speakerId,
      segments: segments.map { $0.toNative() }
    )
  }
}
