import AVFoundation
import Foundation

/// Owns the AVAudioEngine, the input tap, and the format converter. Converts
/// hardware-rate PCM to the target format and emits fixed-size frames to the
/// parent `HybridClarionAudioTap` for fan-out to JS listeners.
internal final class AudioTapSession {
  private let format: NativeAudioTapFormat
  private weak var callbacks: HybridClarionAudioTap?

  private let audioEngine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?

  /// Accumulator for samples that don't divide evenly into target-frame chunks.
  /// 16-bit interleaved PCM stored as raw bytes for direct copy into the
  /// emitted `ArrayBuffer`.
  private var carry = Data()
  /// Bytes per frame at the target format. = sampleRate * frameMs / 1000 * channels * 2.
  private var bytesPerFrame: Int = 0
  /// ms per emitted frame (replays the configured frameDurationMs).
  private var msPerFrame: Double = 0

  private var frameIndex: Int = 0
  private var framesEmittedTotal: Int = 0
  private var framesDroppedTotal: Int = 0
  private var startedAtMs: Double = 0

  private var statsTimer: DispatchSourceTimer?
  private var audioMonitor: AudioTapAudioSessionMonitor?

  private(set) var isRunning: Bool = false

  private let carryLock = NSLock()

  init(format: NativeAudioTapFormat, callbacks: HybridClarionAudioTap) {
    self.format = format
    self.callbacks = callbacks
  }

  // MARK: - Lifecycle

  func start() async throws {
    try await ensurePermission()
    try configureAudioSession()

    let inputNode = audioEngine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)
    let target = try makeTargetFormat()
    targetFormat = target

    if inputFormat.sampleRate != target.sampleRate
      || inputFormat.channelCount != target.channelCount {
      converter = AVAudioConverter(from: inputFormat, to: target)
    }

    bytesPerFrame = Int(format.sampleRate * format.frameDurationMs / 1000.0)
      * Int(format.channels) * Int(format.bitsPerSample / 8)
    msPerFrame = format.frameDurationMs
    frameIndex = 0
    framesEmittedTotal = 0
    framesDroppedTotal = 0

    installAudioMonitor()
    installTap(inputNode: inputNode, inputFormat: inputFormat)
    try audioEngine.start()

    startedAtMs = nowMs()
    startStatsTimer()
    isRunning = true
  }

  func stop() async {
    guard isRunning else { return }
    isRunning = false

    statsTimer?.cancel()
    statsTimer = nil

    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()

    // Drain any partial frame so consumers see a clean end (no torn frame).
    flushCarry()

    audioMonitor = nil

    // Deactivate the audio session so other audio (background music, etc.)
    // resumes. .notifyOthersOnDeactivation is the polite signal to do so.
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // MARK: - Tap

  private func installTap(inputNode: AVAudioInputNode, inputFormat: AVAudioFormat) {
    // bufferSize is in *input* sample frames. 4096 at 48 kHz ≈ 85 ms; the
    // engine batches as the hardware delivers. We re-chunk to the target
    // frameDurationMs ourselves below.
    let bufferSize: AVAudioFrameCount = 4096
    inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
      self?.handle(inputBuffer: buffer)
    }
  }

  private func handle(inputBuffer: AVAudioPCMBuffer) {
    guard isRunning, let target = targetFormat else { return }

    let converted: AVAudioPCMBuffer
    if let conv = converter {
      guard let out = convert(buffer: inputBuffer, using: conv, target: target) else { return }
      converted = out
    } else {
      converted = inputBuffer
    }

    guard let int16 = converted.int16ChannelData else { return }
    let frameCount = Int(converted.frameLength)
    let channels = Int(converted.format.channelCount)
    let byteCount = frameCount * channels * 2

    // Copy interleaved int16 PCM into a Data we can chunk.
    var chunk = Data(count: byteCount)
    chunk.withUnsafeMutableBytes { dst in
      guard let dstPtr = dst.baseAddress else { return }
      if channels == 1 {
        memcpy(dstPtr, int16[0], byteCount)
      } else {
        // Interleave L/R from planar buffers.
        let lhs = int16[0]
        let rhs = int16[1]
        let dstInt16 = dstPtr.assumingMemoryBound(to: Int16.self)
        for i in 0..<frameCount {
          dstInt16[i * 2] = lhs[i]
          dstInt16[i * 2 + 1] = rhs[i]
        }
      }
    }

    emitFrames(appending: chunk)
  }

  /// Append new bytes to the carry buffer and drain as many full frames as fit.
  private func emitFrames(appending bytes: Data) {
    carryLock.lock()
    carry.append(bytes)

    while carry.count >= bytesPerFrame {
      let frame = carry.prefix(bytesPerFrame)
      carry.removeFirst(bytesPerFrame)
      let copy = Data(frame)
      let timestamp = msPerFrame * Double(frameIndex)
      let currentIndex = frameIndex
      frameIndex += 1
      framesEmittedTotal += 1
      carryLock.unlock()

      dispatchFrame(bytes: copy, timestamp: timestamp, index: currentIndex)

      carryLock.lock()
    }
    carryLock.unlock()
  }

  private func dispatchFrame(bytes: Data, timestamp: Double, index: Int) {
    guard let callbacks else { return }
    let pcm: ArrayBuffer
    do {
      pcm = try ArrayBuffer.copy(data: bytes)
    } catch {
      callbacks.emit(error: NativeAudioTapError(
        code: "INTERNAL_ERROR",
        message: "Failed to allocate ArrayBuffer for PCM frame: \(error.localizedDescription)",
        recoverable: false
      ))
      return
    }
    let frame = NativeAudioTapFrame(
      pcm: pcm,
      timestamp: timestamp,
      frameIndex: Double(index),
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitsPerSample: format.bitsPerSample
    )
    callbacks.emit(frame: frame)
  }

  private func flushCarry() {
    carryLock.lock()
    carry.removeAll()
    carryLock.unlock()
  }

  // MARK: - Conversion

  private func convert(
    buffer: AVAudioPCMBuffer,
    using converter: AVAudioConverter,
    target: AVAudioFormat
  ) -> AVAudioPCMBuffer? {
    let ratio = target.sampleRate / buffer.format.sampleRate
    let outFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1)
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: outFrames) else {
      return nil
    }
    var error: NSError?
    var consumed = false
    converter.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    if error != nil { return nil }
    return out
  }

  private func makeTargetFormat() throws -> AVAudioFormat {
    guard let fmt = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: format.sampleRate,
      channels: AVAudioChannelCount(format.channels),
      interleaved: false  // AVAudioConverter requires non-interleaved for int16 → we re-interleave during copy.
    ) else {
      throw AudioTapErr(
        code: "UNSUPPORTED_FORMAT",
        message: "Could not build target AVAudioFormat (sr=\(format.sampleRate), ch=\(format.channels)).",
        recoverable: false
      )
    }
    return fmt
  }

  // MARK: - Audio session

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
    if #available(iOS 18.0, *) {
      options.insert(.allowBluetoothHFP)
    } else {
      options.insert(.allowBluetooth)
    }
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: options)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      throw AudioTapErr(
        code: "AUDIO_BUSY",
        message: "Could not activate AVAudioSession: \(error.localizedDescription)",
        recoverable: true
      )
    }
  }

  private func installAudioMonitor() {
    audioMonitor = AudioTapAudioSessionMonitor(
      onInterruptionBegan: { [weak self] in
        guard let self, self.isRunning else { return }
        self.callbacks?.emit(error: NativeAudioTapError(
          code: "AUDIO_SESSION_INTERRUPTED",
          message: "Audio session interrupted (phone call, Siri, alarm).",
          recoverable: true
        ))
      },
      onInterruptionEnded: { _ in /* let the JS layer decide whether to restart */ },
      onRouteChanged: { [weak self] reason in
        guard let self, self.isRunning else { return }
        switch reason {
        case .oldDeviceUnavailable, .newDeviceAvailable, .override:
          self.callbacks?.emit(error: NativeAudioTapError(
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

  // MARK: - Permission

  private func ensurePermission() async throws {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return
      case .denied:
        throw AudioTapErr(code: "PERMISSION_DENIED", message: "Microphone permission denied.", recoverable: false)
      default:
        let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
          AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        if !granted {
          throw AudioTapErr(code: "PERMISSION_DENIED", message: "Microphone permission denied.", recoverable: false)
        }
      }
      return
    }
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted: return
    case .denied:
      throw AudioTapErr(code: "PERMISSION_DENIED", message: "Microphone permission denied.", recoverable: false)
    default:
      let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        session.requestRecordPermission { cont.resume(returning: $0) }
      }
      if !granted {
        throw AudioTapErr(code: "PERMISSION_DENIED", message: "Microphone permission denied.", recoverable: false)
      }
    }
  }

  // MARK: - Stats

  private func startStatsTimer() {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + .seconds(1), repeating: .seconds(1))
    timer.setEventHandler { [weak self] in
      guard let self, self.isRunning else { return }
      self.callbacks?.emit(stats: NativeAudioTapStats(
        uptimeMs: self.nowMs() - self.startedAtMs,
        framesEmitted: Double(self.framesEmittedTotal),
        framesDropped: Double(self.framesDroppedTotal),
        listenerCount: self.callbacks?.listenerCount ?? 0,
        bufferFillPct: 0  // v1: we drain synchronously per input buffer, no ring.
      ))
    }
    timer.resume()
    statsTimer = timer
  }

  private func nowMs() -> Double {
    return Date().timeIntervalSince1970 * 1_000
  }
}
