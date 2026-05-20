import AVFoundation
import Foundation

internal final class RecorderSession {
  private let config: RecorderConfig
  private weak var callbacks: RecorderCallbacks?

  private let audioEngine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?

  private var encodeFile: EncodeFile?
  private let writeQueue = DispatchQueue(label: RecorderConstants.writeQueueLabel)

  private var running = false
  private var paused = false

  private var sessionStartHostTime: UInt64 = 0
  private var sessionStartWallMs: Double = 0
  private var fileStartedAtMs: Double = 0
  private var lastLevelEmitMs: Double = 0
  private var totalBytesWritten: Int64 = 0

  init(config: RecorderConfig, callbacks: RecorderCallbacks) {
    self.config = config
    self.callbacks = callbacks
  }

  func prepare() async throws {
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
  }

  func start() throws {
    guard let target = targetFormat else {
      throw RecorderError(code: "ENGINE_NOT_READY", message: "Call prepare() first")
    }

    let directory = resolveOutputDirectory()
    encodeFile = try EncodeFile.open(
      in: directory,
      filenamePrefix: config.filenamePrefix ?? RecorderConstants.defaultFilenamePrefix,
      sampleRate: target.sampleRate,
      channels: target.channelCount,
      aacBitrate: config.aacBitrate
    )

    totalBytesWritten = 0
    sessionStartHostTime = mach_absolute_time()
    sessionStartWallMs = nowMs()
    fileStartedAtMs = sessionStartWallMs

    installTap()
    try audioEngine.start()

    running = true
    paused = false
    callbacks?.onState("recording")
  }

  func pause() throws {
    guard running else { throw RecorderError(code: "INVALID_STATE", message: "Not recording") }
    paused = true
    callbacks?.onState("paused")
  }

  func resume() throws {
    guard running else { throw RecorderError(code: "INVALID_STATE", message: "Not recording") }
    paused = false
    callbacks?.onState("recording")
  }

  func stop() async throws -> RecorderOutput {
    guard running else { throw RecorderError(code: "INVALID_STATE", message: "Not recording") }
    callbacks?.onState("stopping")

    running = false
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()

    // Drain any frames still queued on the write queue before closing the file.
    writeQueue.sync { }

    guard let file = encodeFile else {
      throw RecorderError(code: "INTERNAL_ERROR", message: "No output file")
    }
    file.close()
    let durationMs = nowMs() - sessionStartWallMs
    encodeFile = nil

    callbacks?.onState("idle")
    return RecorderOutput(
      uri: "\(RecorderConstants.uriScheme)\(file.url.path)",
      durationMs: durationMs,
      sizeBytes: Double(totalBytesWritten),
      sampleRate: config.sampleRate,
      channels: config.channels,
      bitDepth: config.bitDepth
    )
  }

  func discard() async {
    running = false
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine.stop()
    encodeFile?.cancel()
    encodeFile = nil
    callbacks?.onState("idle")
  }

  func release() async {
    if running { await discard() }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    callbacks?.onState("released")
  }

  private func installTap() {
    let inputNode = audioEngine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)
    let bufferSize = AVAudioFrameCount(inputFormat.sampleRate / Double(RecorderConstants.captureBufferFractionOfSecond))

    inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
      guard let self else { return }
      self.handle(inputBuffer: buffer)
    }
  }

  private func handle(inputBuffer: AVAudioPCMBuffer) {
    guard running, !paused, let file = encodeFile else { return }
    if config.emitAudioLevel { maybeEmitLevels(inputBuffer) }

    guard let converted = convert(inputBuffer) else { return }

    writeQueue.async { [weak self] in
      guard let self else { return }
      self.maybeRotate(currentFile: file)
      self.append(converted, to: self.encodeFile)
    }
  }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let target = targetFormat else { return nil }
    guard let converter else { return buffer }

    let ratio = target.sampleRate / buffer.format.sampleRate
    let outFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1)
    guard let outBuffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: outFrames) else {
      return nil
    }

    var error: NSError?
    var consumed = false
    converter.convert(to: outBuffer, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    if error != nil { return nil }
    return outBuffer
  }

  private func append(_ buffer: AVAudioPCMBuffer, to file: EncodeFile?) {
    guard let file else { return }
    do {
      try file.write(buffer: buffer)
      totalBytesWritten = file.bytesWritten
    } catch {
      callbacks?.onError(RecorderError(code: "IO_ERROR", message: error.localizedDescription))
    }
  }

  private func maybeRotate(currentFile: EncodeFile) {
    guard let rotateAfterMs = config.rotateAfterMs else { return }
    let nowWall = nowMs()
    if nowWall - fileStartedAtMs < rotateAfterMs { return }

    currentFile.close()
    callbacks?.onChunk(
      uri: "\(RecorderConstants.uriScheme)\(currentFile.url.path)",
      startMs: fileStartedAtMs,
      endMs: nowWall,
      sizeBytes: Double(currentFile.bytesWritten)
    )
    openNextFile(startedAtMs: nowWall)
  }

  private func openNextFile(startedAtMs: Double) {
    do {
      let directory = resolveOutputDirectory()
      let next = try EncodeFile.open(
        in: directory,
        filenamePrefix: config.filenamePrefix ?? RecorderConstants.defaultFilenamePrefix,
        sampleRate: config.sampleRate,
        channels: config.channels,
        aacBitrate: config.aacBitrate
      )
      encodeFile = next
      fileStartedAtMs = startedAtMs
    } catch let err as RecorderError {
      callbacks?.onError(err)
    } catch {
      callbacks?.onError(RecorderError(code: "IO_ERROR", message: error.localizedDescription))
    }
  }

  private func maybeEmitLevels(_ buffer: AVAudioPCMBuffer) {
    let now = nowMs()
    if now - lastLevelEmitMs < config.audioLevelIntervalMs { return }
    lastLevelEmitMs = now
    let levels = AudioLevelMeter.compute(buffer: buffer)
    callbacks?.onAudioLevel(rms: levels.rms, peak: levels.peak)
  }

  private func makeTargetFormat() throws -> AVAudioFormat {
    // AAC encoder requires interleaved int16 PCM input; float32 yields
    // AudioCodecInitialize failed / err=-12651 (kAudioConverterErr_FormatNotSupported).
    guard let fmt = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: config.sampleRate,
      channels: AVAudioChannelCount(config.channels),
      interleaved: true
    ) else {
      throw RecorderError(code: "UNSUPPORTED_FORMAT", message: "Invalid target format")
    }
    return fmt
  }

  private func resolveOutputDirectory() -> URL {
    if let custom = config.outputDirectory {
      return URL(fileURLWithPath: custom, isDirectory: true)
    }
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    return cache.appendingPathComponent(RecorderConstants.defaultCacheSubdir, isDirectory: true)
  }

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
    if #available(iOS 18.0, *) {
      options.insert(.allowBluetoothHFP)
    } else {
      options.insert(.allowBluetooth)
    }
    try session.setCategory(.playAndRecord, mode: .default, options: options)
    try session.setActive(true, options: .notifyOthersOnDeactivation)
  }

  private func ensurePermission() async throws {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted:
        return
      case .denied:
        throw RecorderError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      default:
        // Undetermined — prompt the user. iOS uses NSMicrophoneUsageDescription
        // from Info.plist as the prompt copy.
        let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
          AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        if !granted {
          throw RecorderError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
        }
      }
      return
    }
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted:
      return
    case .denied:
      throw RecorderError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
    default:
      // Undetermined — prompt the user. iOS uses NSMicrophoneUsageDescription
      // from Info.plist as the prompt copy.
      let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        session.requestRecordPermission { cont.resume(returning: $0) }
      }
      if !granted {
        throw RecorderError(code: "PERMISSION_DENIED", message: "Microphone permission denied")
      }
    }
  }

  private func nowMs() -> Double {
    return Date().timeIntervalSince1970 * 1_000
  }
}
