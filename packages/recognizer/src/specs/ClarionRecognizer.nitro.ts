import type { HybridObject } from 'react-native-nitro-modules';

export interface NativeRecognizerConfig {
  /** BCP-47 tag, e.g. "en-US", "es-ES". */
  language: string;
  /** Emit interim transcripts as the user speaks. Default: true. */
  emitPartials: boolean;
  /** Emit `audio-level` events for a VU-style meter. Default: false. */
  emitAudioLevel: boolean;
  /** Throttle in ms for `audio-level` events. Default: 50. */
  audioLevelIntervalMs: number;
  /** Prefer the on-device model when available (iOS). Best-effort on Android. Default: false. */
  preferOnDevice: boolean;
}

/** A single word (or short phrase) inside the transcript. iOS-only. */
export interface NativeTranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
  /** -1 when the platform doesn't report it. */
  confidence: number;
  alternatives: string[];
}

export interface NativeTranscriptResult {
  /** UUID per result. */
  id: string;
  /** Shared by every partial + final in one start→stop cycle. */
  sessionId: string;
  /** Wall-clock ms since epoch when the result was produced. */
  timestamp: number;

  text: string;
  isFinal: boolean;
  /** BCP-47 language detected/used (may be empty for some Android providers). */
  language: string;
  /** Aggregate confidence 0..1; -1 if the platform omits it. */
  confidence: number;
  /** ms since session start. -1 if unknown. */
  offsetMs: number;
  /** Recognized audio duration in ms. -1 on Android. */
  durationMs: number;
  /** Word-level segments. Empty array on Android. */
  segments: NativeTranscriptSegment[];
}

export interface NativeRecognizerError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type StateListener = (state: string) => void;
export type AudioLevelListener = (rms: number, peak: number) => void;
export type TranscriptListener = (result: NativeTranscriptResult) => void;
export type ErrorListener = (error: NativeRecognizerError) => void;

export interface ClarionRecognizer
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly state: string;

  /**
   * Returns true when a recognition service is available on this device for
   * the given BCP-47 locale. Use before `start()` to fail fast with a clearer
   * message than mid-session error.
   */
  isAvailable(language: string): Promise<boolean>;

  /**
   * BCP-47 tags supported by the platform recognizer.
   * On iOS: `SFSpeechRecognizer.supportedLocales()`.
   * On Android: queried from the system speech service via broadcast.
   */
  supportedLocales(): Promise<string[]>;

  prepare(config: NativeRecognizerConfig): Promise<void>;
  start(): Promise<void>;
  /** Gracefully end the session. The promise resolves with the final transcript. */
  stop(): Promise<NativeTranscriptResult>;
  /** Abort the session without producing a final transcript. */
  discard(): Promise<void>;
  release(): Promise<void>;

  addStateListener(listener: StateListener): number;
  addAudioLevelListener(listener: AudioLevelListener): number;
  addPartialListener(listener: TranscriptListener): number;
  addFinalListener(listener: TranscriptListener): number;
  addErrorListener(listener: ErrorListener): number;
  removeListener(id: number): void;
  removeAllListeners(): void;
}
