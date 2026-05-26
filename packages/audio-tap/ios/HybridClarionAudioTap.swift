import Foundation
import NitroModules

public typealias AudioTapFrameClosure = (NativeAudioTapFrame) -> Void
public typealias AudioTapStateClosure = (String) -> Void
public typealias AudioTapStatsClosure = (NativeAudioTapStats) -> Void
public typealias AudioTapErrorClosure = (NativeAudioTapError) -> Void

public final class HybridClarionAudioTap: HybridClarionAudioTapSpec {
  private var session: AudioTapSession?
  private var currentStateValue: String = "idle"

  private var nextListenerId: Int = 1
  private var frameListeners: [Int: AudioTapFrameClosure] = [:]
  private var stateListeners: [Int: AudioTapStateClosure] = [:]
  private var statsListeners: [Int: AudioTapStatsClosure] = [:]
  private var errorListeners: [Int: AudioTapErrorClosure] = [:]

  private let listenerLock = NSLock()

  // MARK: - Spec

  public var state: String { currentStateValue }
  public var listenerCount: Double {
    listenerLock.lock(); defer { listenerLock.unlock() }
    return Double(frameListeners.count)
  }

  public func start(format: NativeAudioTapFormat) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      // Idempotent — re-starting a running tap is a no-op.
      if let existing = self.session, existing.isRunning { return }

      let newSession = AudioTapSession(format: format, callbacks: self)
      self.emit(state: "starting")
      do {
        try await newSession.start()
        self.session = newSession
        self.emit(state: "running")
      } catch let err as AudioTapErr {
        self.session = nil
        self.emit(state: "idle")
        let native = err.toNative()
        self.emit(error: native)
        throw NSError(
          domain: "ClarionAudioTap",
          code: 0,
          userInfo: [NSLocalizedDescriptionKey: "{\"code\":\"\(err.code)\",\"message\":\"\(escape(err.message))\"}"]
        )
      } catch {
        self.session = nil
        self.emit(state: "idle")
        let native = NativeAudioTapError(
          code: "INTERNAL_ERROR",
          message: error.localizedDescription,
          recoverable: false
        )
        self.emit(error: native)
        throw error
      }
    }
  }

  public func stop() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self, let s = self.session else { return }
      self.emit(state: "stopping")
      await s.stop()
      self.session = nil
      self.emit(state: "idle")
    }
  }

  public func release() throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      if let s = self.session {
        await s.stop()
        self.session = nil
      }
      self.removeAllListenersInternal()
      self.emit(state: "released")
    }
  }

  public func addFrameListener(listener: @escaping (NativeAudioTapFrame) -> Void) throws -> Double {
    return Double(addListener { id in self.frameListeners[id] = listener })
  }

  public func addStateListener(listener: @escaping (String) -> Void) throws -> Double {
    return Double(addListener { id in self.stateListeners[id] = listener })
  }

  public func addStatsListener(listener: @escaping (NativeAudioTapStats) -> Void) throws -> Double {
    return Double(addListener { id in self.statsListeners[id] = listener })
  }

  public func addErrorListener(listener: @escaping (NativeAudioTapError) -> Void) throws -> Double {
    return Double(addListener { id in self.errorListeners[id] = listener })
  }

  public func removeListener(id: Double) throws {
    let key = Int(id)
    listenerLock.lock(); defer { listenerLock.unlock() }
    frameListeners.removeValue(forKey: key)
    stateListeners.removeValue(forKey: key)
    statsListeners.removeValue(forKey: key)
    errorListeners.removeValue(forKey: key)
  }

  public func removeAllListeners() throws {
    removeAllListenersInternal()
  }

  // MARK: - Internal helpers used by AudioTapSession

  internal func emit(frame: NativeAudioTapFrame) {
    let snapshot: [AudioTapFrameClosure]
    listenerLock.lock()
    snapshot = Array(frameListeners.values)
    listenerLock.unlock()
    for closure in snapshot { closure(frame) }
  }

  internal func emit(state: String) {
    currentStateValue = state
    let snapshot: [AudioTapStateClosure]
    listenerLock.lock()
    snapshot = Array(stateListeners.values)
    listenerLock.unlock()
    for closure in snapshot { closure(state) }
  }

  internal func emit(stats: NativeAudioTapStats) {
    let snapshot: [AudioTapStatsClosure]
    listenerLock.lock()
    snapshot = Array(statsListeners.values)
    listenerLock.unlock()
    for closure in snapshot { closure(stats) }
  }

  internal func emit(error: NativeAudioTapError) {
    let snapshot: [AudioTapErrorClosure]
    listenerLock.lock()
    snapshot = Array(errorListeners.values)
    listenerLock.unlock()
    for closure in snapshot { closure(error) }
  }

  // MARK: - Private

  private func addListener(_ register: (Int) -> Void) -> Int {
    listenerLock.lock()
    let id = nextListenerId
    nextListenerId += 1
    register(id)
    listenerLock.unlock()
    return id
  }

  private func removeAllListenersInternal() {
    listenerLock.lock()
    frameListeners.removeAll()
    stateListeners.removeAll()
    statsListeners.removeAll()
    errorListeners.removeAll()
    listenerLock.unlock()
  }
}

/// Minimal JSON escape so the JS-side `tryParseStructured` can recover the
/// native code/message from an NSError.localizedDescription.
private func escape(_ s: String) -> String {
  return s.replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: "\\n")
}
