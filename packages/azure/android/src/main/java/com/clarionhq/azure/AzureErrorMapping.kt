package com.clarionhq.azure

import com.microsoft.cognitiveservices.speech.CancellationDetails
import com.microsoft.cognitiveservices.speech.CancellationErrorCode
import com.microsoft.cognitiveservices.speech.CancellationReason

/**
 * Maps Azure cancellation events to Clarion's internal error code surface.
 * Called from AzureSession's `canceled` event handler and from setup paths.
 */
internal object AzureErrorMapping {

  /** Map a [CancellationDetails] (from a canceled event or completed result). */
  fun map(details: CancellationDetails): AzureError =
    map(details.reason, details.errorCode, details.errorDetails)

  /**
   * Map the three primitive fields the SDK exposes on cancellation events.
   * Both [CancellationDetails] and the wrapper event-args carry these.
   */
  fun map(
    reason: CancellationReason?,
    errorCode: CancellationErrorCode?,
    errorDetails: String?,
  ): AzureError {
    val message = errorDetails ?: ""
    return AzureError(
      code = mapErrorCode(reason, errorCode, message),
      message = formatMessage(reason, errorCode, message),
      recoverable = isRecoverable(errorCode),
    )
  }

  /** Map an arbitrary Throwable thrown by the SDK during setup/start/stop. */
  fun map(t: Throwable): AzureError {
    val msg = t.message ?: t::class.java.simpleName
    return AzureError(
      code = "INTERNAL_ERROR",
      message = "Azure SDK error: $msg",
      cause = t,
    )
  }

  private fun mapErrorCode(
    reason: CancellationReason?,
    errorCode: CancellationErrorCode?,
    message: String,
  ): String {
    if (reason == CancellationReason.EndOfStream) return "CANCELLED"

    return when (errorCode) {
      null, CancellationErrorCode.NoError -> "CANCELLED"
      CancellationErrorCode.AuthenticationFailure -> "AUTH_FAILED"
      CancellationErrorCode.BadRequest -> {
        // Often "language not supported" lands here.
        if (message.lowercase().contains("language")) "UNSUPPORTED_LANGUAGE" else "INVALID_STATE"
      }
      CancellationErrorCode.TooManyRequests, CancellationErrorCode.Forbidden -> "QUOTA_EXCEEDED"
      CancellationErrorCode.ConnectionFailure -> "NETWORK_UNAVAILABLE"
      CancellationErrorCode.ServiceTimeout -> "NETWORK_TIMEOUT"
      CancellationErrorCode.ServiceError, CancellationErrorCode.ServiceUnavailable -> "NETWORK_UNAVAILABLE"
      CancellationErrorCode.RuntimeError -> "INTERNAL_ERROR"
      else -> "INTERNAL_ERROR"
    }
  }

  private fun isRecoverable(errorCode: CancellationErrorCode?): Boolean = when (errorCode) {
    CancellationErrorCode.ConnectionFailure,
    CancellationErrorCode.ServiceTimeout,
    CancellationErrorCode.ServiceUnavailable,
    CancellationErrorCode.TooManyRequests -> true
    else -> false
  }

  private fun formatMessage(
    reason: CancellationReason?,
    errorCode: CancellationErrorCode?,
    message: String,
  ): String {
    if (message.isNotEmpty()) return message
    return "Azure cancellation (reason=$reason, code=$errorCode)"
  }
}
