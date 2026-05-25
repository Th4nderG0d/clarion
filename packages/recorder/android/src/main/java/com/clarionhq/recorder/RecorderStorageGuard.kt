package com.clarionhq.recorder

import android.os.StatFs
import java.io.File

/**
 * Pre-flight disk-space check. Throws STORAGE_FULL if there isn't enough room
 * to safely begin recording. AAC at 32 kbps is ~4 KB/s — 50 MB lets you
 * record for ~3 hours. Conservative floor; long recordings should still poll
 * separately during the session.
 */
internal object RecorderStorageGuard {
  /** Minimum free bytes required at start. */
  private const val MIN_FREE_BYTES: Long = 50L * 1024L * 1024L

  /** Fail fast with [RecorderError] STORAGE_FULL if the volume is too full. */
  fun ensureSufficientStorage(targetDir: File) {
    val free = freeBytes(targetDir)
    if (free < MIN_FREE_BYTES) {
      throw RecorderError(
        "STORAGE_FULL",
        "Not enough free storage to start recording. " +
          "Have ${free / 1024L / 1024L} MB free, need at least " +
          "${MIN_FREE_BYTES / 1024L / 1024L} MB.",
        recoverable = true,
      )
    }
  }

  /**
   * Volume-wide free bytes for [targetDir]'s filesystem. Probes the parent
   * directory if [targetDir] doesn't exist yet (common on first run before
   * the cache subdir is created). Returns Long.MAX_VALUE on probe failure so
   * we don't block on transient FS quirks; the real IO will surface its own
   * error if writes actually fail.
   */
  private fun freeBytes(targetDir: File): Long {
    val probe = if (targetDir.exists()) targetDir else targetDir.parentFile ?: return Long.MAX_VALUE
    return runCatching { StatFs(probe.absolutePath).availableBytes }
      .getOrDefault(Long.MAX_VALUE)
  }
}
