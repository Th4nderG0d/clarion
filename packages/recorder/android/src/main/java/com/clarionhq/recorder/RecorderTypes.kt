package com.clarionhq.recorder

internal class RecorderError(
  val code: String,
  message: String,
  val recoverable: Boolean = false,
  cause: Throwable? = null,
) : Exception(message, cause)

internal interface RecorderCallbacks {
  fun onState(state: String)
  fun onAudioLevel(rms: Double, peak: Double)
  fun onChunk(uri: String, startMs: Long, endMs: Long, sizeBytes: Long)
  fun onError(error: RecorderError)
}

internal inline fun RecorderCallbacks.runCatchingRecorder(
  fallbackCode: String,
  fallbackPrefix: String,
  block: () -> Unit,
) {
  try {
    block()
  } catch (e: RecorderError) {
    onError(e)
  } catch (e: Throwable) {
    onError(RecorderError(fallbackCode, "$fallbackPrefix: ${e.message}", cause = e))
  }
}
