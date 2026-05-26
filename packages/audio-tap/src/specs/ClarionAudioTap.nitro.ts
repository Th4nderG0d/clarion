import type { HybridObject } from 'react-native-nitro-modules';

/**
 * PCM format the tap opens the microphone with. All consumers see the same
 * format — there is no per-consumer resampling in v1.
 *
 * The native layer validates this at `start()` and rejects with
 * `INVALID_CONFIG` if anything is out of range.
 */
export interface NativeAudioTapFormat {
  /** Hz. One of 16000, 22050, 44100, 48000. */
  sampleRate: number;
  /** 1 (mono) or 2 (stereo, interleaved L/R). */
  channels: number;
  /** Bits per sample. Only 16 is supported in v1. */
  bitsPerSample: number;
  /** How much audio is buffered per emitted frame. One of 10, 20, 50, 100. */
  frameDurationMs: number;
}

/**
 * One PCM frame emitted to JS consumers. `pcm` is a freshly-allocated
 * `ArrayBuffer` of signed 16-bit little-endian samples — interleaved L/R
 * if `channels === 2`.
 */
export interface NativeAudioTapFrame {
  pcm: ArrayBuffer;
  /** ms since `start()`. Monotonic, gap-free unless `framesDropped > 0`. */
  timestamp: number;
  /** 0, 1, 2, … — increments by 1 per emitted frame. Detect gaps via `framesDropped`. */
  frameIndex: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * Periodic snapshot of tap health. Emitted at ~1 Hz from `addStatsListener`.
 * Use `framesDropped` + `bufferFillPct` to detect slow consumers.
 */
export interface NativeAudioTapStats {
  uptimeMs: number;
  framesEmitted: number;
  framesDropped: number;
  listenerCount: number;
  /** 0–100. Sustained > 70 means at least one consumer is too slow. */
  bufferFillPct: number;
}

export interface NativeAudioTapError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type FrameListener = (frame: NativeAudioTapFrame) => void;
export type StateListener = (state: string) => void;
export type StatsListener = (stats: NativeAudioTapStats) => void;
export type ErrorListener = (error: NativeAudioTapError) => void;

/**
 * Shared microphone fan-out. Opens the system mic once, buffers PCM into a
 * ring, and dispatches frames to every registered `FrameListener`.
 *
 * Lifecycle:
 *   idle → starting → running → stopping → idle → … → released
 *
 * A slow listener cannot stall the producer — the ring drops frames if the
 * pressure is sustained, and `NativeAudioTapStats.framesDropped` ticks up.
 */
export interface ClarionAudioTap
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly state: string;
  readonly listenerCount: number;

  /** Open the mic with the requested format. Rejects with INVALID_CONFIG / PERMISSION_DENIED / AUDIO_BUSY. */
  start(format: NativeAudioTapFormat): Promise<void>;
  /** Close the mic and flush any buffered frames. Safe to call from any state. */
  stop(): Promise<void>;
  /** Release native resources. Tap is unusable after this. */
  release(): Promise<void>;

  addFrameListener(listener: FrameListener): number;
  addStateListener(listener: StateListener): number;
  addStatsListener(listener: StatsListener): number;
  addErrorListener(listener: ErrorListener): number;
  removeListener(id: number): void;
  removeAllListeners(): void;
}
