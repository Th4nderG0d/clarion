import AVFoundation
import Foundation

/// Observes AVAudioSession interruption + route-change notifications.
/// Calls the provided closures on the main queue so callers don't need to
/// thread-marshal. Auto-unregisters on deinit.
///
/// Lifecycle: instantiate in `prepare()`, hold strong reference, set to nil
/// in `release()` (deinit removes the observers).
internal final class AudioSessionMonitor {
  /// Called when audio is being taken away (phone call, Siri, alarm).
  let onInterruptionBegan: () -> Void
  /// Called when interruption ended. `shouldResume` reflects iOS's hint;
  /// callers may still choose to require manual user action.
  let onInterruptionEnded: (_ shouldResume: Bool) -> Void
  /// Called when the audio route changes (BT connect/disconnect, headphones in/out).
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
