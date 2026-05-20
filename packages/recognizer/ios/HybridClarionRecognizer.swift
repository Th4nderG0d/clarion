import Foundation
import NitroModules
import Speech

public typealias StateClosure = (String) -> Void
public typealias AudioLevelClosure = (Double, Double) -> Void
public typealias TranscriptClosure = (NativeTranscriptResult) -> Void
public typealias ErrorClosure = (NativeRecognizerError) -> Void

public final class HybridClarionRecognizer: HybridClarionRecognizerSpec {
  private var session: RecognizerSession?
  private var currentStateValue: String = "idle"

  private var nextListenerId: Int = 1
  private var stateListeners: [Int: StateClosure] = [:]
  private var audioLevelListeners: [Int: AudioLevelClosure] = [:]
  private var partialListeners: [Int: TranscriptClosure] = [:]
  private var finalListeners: [Int: TranscriptClosure] = [:]
  private var errorListeners: [Int: ErrorClosure] = [:]

  private let listenerLock = NSLock()

  public var state: String { currentStateValue }

  public func isAvailable(language: String) throws -> Promise<Bool> {
    return Promise.async {
      guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) else {
        return false
      }
      return recognizer.isAvailable
    }
  }

  public func supportedLocales() throws -> Promise<[String]> {
    return Promise.async {
      return SFSpeechRecognizer.supportedLocales().map { $0.identifier }
    }
  }

  public func prepare(config: NativeRecognizerConfig) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      let parsed = config.toSwiftConfig()
      let newSession = RecognizerSession(config: parsed, callbacks: self)
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
        throw RecognizerError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
      }
      self.emit(state: "starting")
      try session.start()
    }
  }

  public func stop() throws -> Promise<NativeTranscriptResult> {
    return Promise.async { [weak self] in
      guard let self, let session = self.session else {
        throw RecognizerError(code: "ENGINE_NOT_READY", message: "No session")
      }
      let result = try await session.stop()
      return result.toNative()
    }
  }

  public func discard() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      await self?.session?.discard()
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

  public func addStateListener(listener: @escaping StateClosure) throws -> Double {
    register { id in stateListeners[id] = listener }
  }

  public func addAudioLevelListener(listener: @escaping AudioLevelClosure) throws -> Double {
    register { id in audioLevelListeners[id] = listener }
  }

  public func addPartialListener(listener: @escaping TranscriptClosure) throws -> Double {
    register { id in partialListeners[id] = listener }
  }

  public func addFinalListener(listener: @escaping TranscriptClosure) throws -> Double {
    register { id in finalListeners[id] = listener }
  }

  public func addErrorListener(listener: @escaping ErrorClosure) throws -> Double {
    register { id in errorListeners[id] = listener }
  }

  public func removeListener(id: Double) throws {
    listenerLock.lock(); defer { listenerLock.unlock() }
    let key = Int(id)
    stateListeners.removeValue(forKey: key)
    audioLevelListeners.removeValue(forKey: key)
    partialListeners.removeValue(forKey: key)
    finalListeners.removeValue(forKey: key)
    errorListeners.removeValue(forKey: key)
  }

  public func removeAllListeners() {
    listenerLock.lock(); defer { listenerLock.unlock() }
    stateListeners.removeAll()
    audioLevelListeners.removeAll()
    partialListeners.removeAll()
    finalListeners.removeAll()
    errorListeners.removeAll()
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

extension HybridClarionRecognizer: RecognizerCallbacks {
  func onState(_ state: String) {
    emit(state: state)
  }

  func onAudioLevel(rms: Double, peak: Double) {
    snapshotListeners(audioLevelListeners).forEach { $0(rms, peak) }
  }

  func onPartial(_ transcript: RecognizerTranscript) {
    let payload = transcript.toNative()
    snapshotListeners(partialListeners).forEach { $0(payload) }
  }

  func onFinal(_ transcript: RecognizerTranscript) {
    let payload = transcript.toNative()
    snapshotListeners(finalListeners).forEach { $0(payload) }
  }

  func onError(_ error: RecognizerError) {
    currentStateValue = "error"
    let payload = NativeRecognizerError(
      code: error.code,
      message: error.message,
      recoverable: error.recoverable
    )
    snapshotListeners(errorListeners).forEach { $0(payload) }
  }
}

private extension NativeRecognizerConfig {
  func toSwiftConfig() -> RecognizerConfig {
    return RecognizerConfig(
      language: language,
      emitPartials: emitPartials,
      emitAudioLevel: emitAudioLevel,
      audioLevelIntervalMs: audioLevelIntervalMs,
      preferOnDevice: preferOnDevice
    )
  }
}

private extension RecognizerSegment {
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

private extension RecognizerTranscript {
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
      segments: segments.map { $0.toNative() }
    )
  }
}
