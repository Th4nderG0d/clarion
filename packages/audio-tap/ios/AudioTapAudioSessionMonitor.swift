import AVFoundation
import Foundation

/// Mirrors `AudioSessionMonitor` from `@clarionhq/recorder` — local copy so
/// audio-tap stays a leaf package (no cross-package native deps).
internal final class AudioTapAudioSessionMonitor {
  let onInterruptionBegan: () -> Void
  let onInterruptionEnded: (_ shouldResume: Bool) -> Void
  let onRouteChanged: (_ reason: AVAudioSession.RouteChangeReason) -> Void

  init(
    onInterruptionBegan: @escaping () -> Void,
    onInterruptionEnded: @escaping (Bool) -> Void,
    onRouteChanged: @escaping (AVAudioSession.RouteChangeReason) -> Void
  ) {
    self.onInterruptionBegan = onInterruptionBegan
    self.onInterruptionEnded = onInterruptionEnded
    self.onRouteChanged = onRouteChanged

    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    center.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: session
    )
    center.addObserver(
      self,
      selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: session
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleInterruption(_ note: Notification) {
    guard let info = note.userInfo,
          let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      switch type {
      case .began:
        self.onInterruptionBegan()
      case .ended:
        var shouldResume = false
        if let optsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt {
          let opts = AVAudioSession.InterruptionOptions(rawValue: optsValue)
          shouldResume = opts.contains(.shouldResume)
        }
        self.onInterruptionEnded(shouldResume)
      @unknown default:
        return
      }
    }
  }

  @objc private func handleRouteChange(_ note: Notification) {
    guard let info = note.userInfo,
          let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
          let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
    DispatchQueue.main.async { [weak self] in
      self?.onRouteChanged(reason)
    }
  }
}
