import Foundation
import NitroModules

public typealias StateClosure = (String) -> Void
public typealias AudioLevelClosure = (Double, Double) -> Void
public typealias ChunkClosure = (String, Double, Double, Double) -> Void
public typealias ErrorClosure = (NativeRecorderError) -> Void

public final class HybridClarionRecorder: HybridClarionRecorderSpec {
  private var session: RecorderSession?
  private var currentStateValue: String = "idle"

  private var nextListenerId: Int = 1
  private var stateListeners: [Int: StateClosure] = [:]
  private var audioLevelListeners: [Int: AudioLevelClosure] = [:]
  private var chunkListeners: [Int: ChunkClosure] = [:]
  private var errorListeners: [Int: ErrorClosure] = [:]

  private let listenerLock = NSLock()

  public var state: String { currentStateValue }

  public func prepare(config: NativeRecorderConfig) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      let parsed = config.toSwiftConfig()
      let newSession = RecorderSession(config: parsed, callbacks: self)
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
        throw RecorderError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
      }
      self.emit(state: "starting")
      try session.start()
    }
  }

  public func pause() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      try self?.session?.pause()
    }
  }

  public func resume() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      try self?.session?.resume()
    }
  }

  public func stop() throws -> Promise<NativeRecorderResult> {
    return Promise.async { [weak self] in
      guard let self, let session = self.session else {
        throw RecorderError(code: "ENGINE_NOT_READY", message: "No session")
      }
      let output = try await session.stop()
      return output.toNative()
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

  public func addChunkListener(listener: @escaping ChunkClosure) throws -> Double {
    register { id in chunkListeners[id] = listener }
  }

  public func addErrorListener(listener: @escaping ErrorClosure) throws -> Double {
    register { id in errorListeners[id] = listener }
  }

  public func removeListener(id: Double) throws {
    listenerLock.lock(); defer { listenerLock.unlock() }
    let key = Int(id)
    stateListeners.removeValue(forKey: key)
    audioLevelListeners.removeValue(forKey: key)
    chunkListeners.removeValue(forKey: key)
    errorListeners.removeValue(forKey: key)
  }

  public func removeAllListeners() {
    listenerLock.lock(); defer { listenerLock.unlock() }
    stateListeners.removeAll()
    audioLevelListeners.removeAll()
    chunkListeners.removeAll()
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

extension HybridClarionRecorder: RecorderCallbacks {
  func onState(_ state: String) {
    emit(state: state)
  }

  func onAudioLevel(rms: Double, peak: Double) {
    snapshotListeners(audioLevelListeners).forEach { $0(rms, peak) }
  }

  func onChunk(uri: String, startMs: Double, endMs: Double, sizeBytes: Double) {
    snapshotListeners(chunkListeners).forEach { $0(uri, startMs, endMs, sizeBytes) }
  }

  func onError(_ error: RecorderError) {
    currentStateValue = "error"
    let payload = NativeRecorderError(
      code: error.code,
      message: error.message,
      recoverable: error.recoverable
    )
    snapshotListeners(errorListeners).forEach { $0(payload) }
  }
}

private extension NativeRecorderConfig {
  func toSwiftConfig() -> RecorderConfig {
    return RecorderConfig(
      sampleRate: sampleRate,
      channels: UInt32(channels),
      bitDepth: UInt32(bitDepth),
      outputDirectory: outputDirectory,
      filenamePrefix: filenamePrefix,
      rotateAfterMs: rotateAfterMs,
      emitAudioLevel: emitAudioLevel,
      audioLevelIntervalMs: audioLevelIntervalMs,
      aacBitrate: Int(aacBitrate)
    )
  }
}

private extension RecorderOutput {
  func toNative() -> NativeRecorderResult {
    return NativeRecorderResult(
      uri: uri,
      durationMs: durationMs,
      sizeBytes: sizeBytes,
      sampleRate: sampleRate,
      channels: Double(channels),
      bitDepth: Double(bitDepth)
    )
  }
}
