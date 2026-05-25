import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Azure Speech SDK configuration.
 *
 * Auth: provide ONE of —
 *   1. `subscriptionKey` + `region`          (simplest)
 *   2. `authToken`       + `region`          (short-lived token from your server; preferred)
 *   3. `endpoint`        (+ optional key/token; for custom endpoints / sovereign clouds)
 *
 * The native layer validates this at `prepare()` and throws INVALID_CONFIG if none match.
 */
export interface NativeAzureConfig {
  /** BCP-47 tag, e.g. "en-US", "es-ES". */
  language: string;
  /** Emit interim transcripts as the user speaks. Default: true. */
  emitPartials: boolean;
  /** Emit `audio-level` events for a VU-style meter. Default: false. */
  emitAudioLevel: boolean;
  /** Throttle in ms for `audio-level` events. Default: 50. */
  audioLevelIntervalMs: number;

  /** Azure subscription key. Required unless `authToken` or `endpoint` is set. */
  subscriptionKey: string;
  /** Azure region, e.g. "eastus", "westeurope". Required with key OR token. */
  region: string;
  /** Short-lived authorization token (preferred over shipping the key in the app). */
  authToken: string;
  /** Custom endpoint URL (sovereign cloud, private endpoint, custom speech model). */
  endpoint: string;

  /** "simple" returns just the transcript text. "detailed" enables alternatives + per-word segments. Default: "detailed". */
  outputFormat: string;
  /** "masked" | "removed" | "raw" | "none". Default: "masked". */
  profanity: string;
  /** Enable speaker diarization (Azure conversation transcriber, en-US only). Default: false. */
  enableSpeakerDiarization: boolean;
  /** Comma-separated BCP-47 candidates for auto language detection. Empty string disables. */
  autoDetectLanguages: string;
  /**
   * Auto-stop after N ms of silence (silence-detection / VAD). 0 disables.
   * Maps to Azure SpeechServiceConnection_EndSilenceTimeoutMs.
   */
  silenceTimeoutMs: number;
  /**
   * Newline-separated phrase hints to bias recognition on custom vocab.
   * Empty disables. Maps to SPXPhraseListGrammar (`addPhrase` per line).
   */
  phraseHints: string;
  /**
   * If true and the SDK refuses diarization on the current tier, fall back
   * to non-diarization mode and emit a DEGRADED_MODE warning instead of
   * failing prepare().
   */
  degradeOnTierMismatch: boolean;
}

/** A single word (or short phrase) inside the transcript. */
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
  /** BCP-47 language detected/used. */
  language: string;
  /** Aggregate confidence 0..1; -1 if the platform omits it. */
  confidence: number;
  /** ms since session start. -1 if unknown. */
  offsetMs: number;
  /** Recognized audio duration in ms. -1 if unknown. */
  durationMs: number;
  /** Speaker label from diarization (e.g. "Guest-1"). Empty string when off. */
  speakerId: string;
  /** Word-level segments. Populated on both iOS and Android when outputFormat="detailed". */
  segments: NativeTranscriptSegment[];
}

export interface NativeAzureError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type StateListener = (state: string) => void;
export type AudioLevelListener = (rms: number, peak: number) => void;
export type TranscriptListener = (result: NativeTranscriptResult) => void;
export type ErrorListener = (error: NativeAzureError) => void;
/**
 * Fired when Azure detects speech boundaries during a session.
 * `kind` is `"started"` or `"ended"`. `offsetMs` is the recognizer's offset
 * from session start (-1 if unknown).
 */
export type SpeechBoundaryListener = (kind: string, offsetMs: number) => void;

export interface ClarionAzure
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly state: string;

  /**
   * Returns true when the Azure Speech SDK is reachable AND the supplied
   * credentials are accepted (best-effort probe). Use before `start()` to
   * fail fast with a clearer message than mid-session error.
   */
  isAvailable(config: NativeAzureConfig): Promise<boolean>;

  prepare(config: NativeAzureConfig): Promise<void>;
  start(): Promise<void>;
  /** Gracefully end the session. The promise resolves with the final transcript. */
  stop(): Promise<NativeTranscriptResult>;
  /** Abort the session without producing a final transcript. */
  discard(): Promise<void>;
  release(): Promise<void>;

  /**
   * Swap the auth token (e.g. before STS expiry). No-op if no recognizer
   * exists yet — the new token is stored and used on the next prepare().
   */
  updateAuthToken(token: string): Promise<void>;

  addStateListener(listener: StateListener): number;
  addAudioLevelListener(listener: AudioLevelListener): number;
  addPartialListener(listener: TranscriptListener): number;
  addFinalListener(listener: TranscriptListener): number;
  addErrorListener(listener: ErrorListener): number;
  /**
   * Fired when the recognizer detects the start or end of speech
   * (`SPXSpeechStartDetected` / `SPXSpeechEndDetected`). Useful for
   * "pulsing mic" UIs and auto-stop heuristics.
   */
  addSpeechBoundaryListener(listener: SpeechBoundaryListener): number;
  removeListener(id: number): void;
  removeAllListeners(): void;
}
