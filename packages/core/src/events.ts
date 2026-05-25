import type { ClarionError } from './errors';
import type { RecorderResult, TranscriptResult } from './results';
import type { EngineState } from './state';

/**
 * Non-fatal signals an engine can emit alongside the usual error/result stream.
 *
 * Warnings are advisory — the engine kept running and the caller doesn't
 * **need** to react, but a good UI surfaces them (e.g. "your token will
 * refresh in 30 seconds", "retrying after a brief network blip").
 */
export type WarningCode =
  /** Engine auto-retried a transient failure. `details.attempt` / `details.maxAttempts` set. */
  | 'RETRY_ATTEMPTED'
  /** Azure auth token is approaching expiry; refresh has been queued or just ran. */
  | 'TOKEN_NEAR_EXPIRY'
  /** Pre-warm / first connect took longer than expected. `details.elapsedMs` set. */
  | 'NETWORK_SLOW'
  /** Audio route changed but session continues (e.g. BT headphones disconnected). */
  | 'AUDIO_ROUTE_CHANGED'
  /** A requested feature wasn't available; engine fell back to a working alternative. */
  | 'DEGRADED_MODE'
  /** Background mode entered; session paused (auto-resume on foreground). */
  | 'BACKGROUNDED'
  /** Catch-all. */
  | 'UNKNOWN';

export interface ClarionWarning {
  code: WarningCode;
  /** Technical message — safe to log. */
  message: string;
  /** Structured details for analytics. */
  details?: Record<string, unknown>;
}

export type ClarionEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'audio-level'; rms: number; peak: number }
  | {
      /** Emitted on every final whose aggregate confidence is below the engine's threshold. */
      type: 'audio-confidence';
      /** 0–1; lower = service is struggling to recognize. */
      confidence: number;
      /** The transcript that triggered this signal. */
      result: TranscriptResult;
    }
  | {
      /** Recognizer detected the start of speech (`SPXSpeechStartDetected`). */
      type: 'speech-started';
      /** ms since session start; -1 if unknown. */
      offsetMs: number;
    }
  | {
      /** Recognizer detected the end of speech (`SPXSpeechEndDetected`). */
      type: 'speech-ended';
      /** ms since session start; -1 if unknown. */
      offsetMs: number;
    }
  | { type: 'partial'; result: TranscriptResult }
  | { type: 'final'; result: TranscriptResult }
  | { type: 'chunk'; uri: string; startMs: number; endMs: number; sizeBytes: number }
  | { type: 'recording-complete'; result: RecorderResult }
  | { type: 'error'; error: ClarionError }
  | { type: 'warning'; warning: ClarionWarning };

export type ClarionEventType = ClarionEvent['type'];

export type Listener<T> = (event: T) => void;
export type Unsubscribe = () => void;
