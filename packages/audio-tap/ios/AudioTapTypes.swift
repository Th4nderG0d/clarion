import Foundation

/// Internal Swift-throwable. Mapped to `NativeAudioTapError` at the Nitro
/// bridge layer (`HybridClarionAudioTap`). We can't make
/// `NativeAudioTapError` directly `Error`-conformant — it's a C++ struct
/// typealias.
internal struct AudioTapErr: Error, CustomStringConvertible {
  let code: String
  let message: String
  let recoverable: Bool

  init(code: String, message: String, recoverable: Bool = false) {
    self.code = code
    self.message = message
    self.recoverable = recoverable
  }

  var description: String { "AudioTapErr(\(code)): \(message)" }

  func toNative() -> NativeAudioTapError {
    return NativeAudioTapError(code: code, message: message, recoverable: recoverable)
  }
}
