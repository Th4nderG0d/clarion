import Foundation
import MicrosoftCognitiveServicesSpeech

/// Maps Azure cancellation events to Clarion's internal error code surface.
/// Called from AzureSession's `canceled` event handler and from setup paths.
internal enum AzureErrorMapping {

  /// Map an `SPXCancellationDetails` (from a completed result) into an `AzureError`.
  static func map(_ details: SPXCancellationDetails) -> AzureError {
    return map(
      reason: details.reason,
      errorCode: details.errorCode,
      errorDetails: details.errorDetails
    )
  }

  /// Map a `SPXSpeechRecognitionCanceledEventArgs` (from the `canceled` handler).
  /// The event args don't extend `SPXCancellationDetails` — they expose the same
  /// fields as direct properties, so we read them off here.
  static func map(_ args: SPXSpeechRecognitionCanceledEventArgs) -> AzureError {
    return map(
      reason: args.reason,
      errorCode: args.errorCode,
      errorDetails: args.errorDetails
    )
  }

  /// Shared mapping body, parameterized by the three primitive fields both
  /// `SPXCancellationDetails` and `SPXSpeechRecognitionCanceledEventArgs` expose.
  static func map(
    reason: SPXCancellationReason,
    errorCode: SPXCancellationErrorCode,
    errorDetails: String?
  ) -> AzureError {
    let message = errorDetails ?? ""
    return AzureError(
      code: mapErrorCode(reason: reason, errorCode: errorCode, message: message),
      message: formatMessage(reason: reason, errorCode: errorCode, message: message),
      recoverable: isRecoverable(errorCode)
    )
  }

  /// Map an arbitrary NSError thrown by the SDK during setup/start/stop.
  static func map(_ error: Error) -> AzureError {
    let ns = error as NSError
    return AzureError(
      code: "INTERNAL_ERROR",
      message: "Azure SDK error: \(ns.localizedDescription) (\(ns.domain) \(ns.code))"
    )
  }

  private static func mapErrorCode(
    reason: SPXCancellationReason,
    errorCode: SPXCancellationErrorCode,
    message: String
  ) -> String {
    if reason == .endOfStream { return "CANCELLED" }

    switch errorCode {
    case .noError:
      return "CANCELLED"
    case .authenticationFailure:
      return "AUTH_FAILED"
    case .badRequest:
      // Often "language not supported" lands here.
      if message.lowercased().contains("language") { return "UNSUPPORTED_LANGUAGE" }
      return "INVALID_STATE"
    case .tooManyRequests, .forbidden:
      return "QUOTA_EXCEEDED"
    case .connectionFailure:
      return "NETWORK_UNAVAILABLE"
    case .serviceTimeout:
      return "NETWORK_TIMEOUT"
    case .serviceError, .serviceUnavailable:
      return "NETWORK_UNAVAILABLE"
    case .runtimeError:
      return "INTERNAL_ERROR"
    @unknown default:
      return "INTERNAL_ERROR"
    }
  }

  private static func isRecoverable(_ errorCode: SPXCancellationErrorCode) -> Bool {
    switch errorCode {
    case .connectionFailure, .serviceTimeout, .serviceUnavailable, .tooManyRequests:
      return true
    default:
      return false
    }
  }

  private static func formatMessage(
    reason: SPXCancellationReason,
    errorCode: SPXCancellationErrorCode,
    message: String
  ) -> String {
    if message.isEmpty {
      return "Azure cancellation (reason=\(reason.rawValue), code=\(errorCode.rawValue))"
    }
    return message
  }
}
