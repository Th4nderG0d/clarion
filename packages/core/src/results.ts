import type { AudioFormat } from './format';

export interface RecorderResult {
  uri: string;
  durationMs: number;
  sizeBytes: number;
  container: 'm4a';
  audioFormat: AudioFormat;
}

export interface TranscriptAlternative {
  text: string;
  /** 0..1 confidence score where available; -1 if the platform omits it. */
  confidence: number;
}

/**
 * A single word (or short phrase) inside a transcript, with its timing and
 * confidence. iOS populates this from `SFTranscriptionSegment`. Android's
 * standard `SpeechRecognizer` does not expose per-word timings, so segments
 * will be empty / absent on Android.
 */
export interface TranscriptSegment {
  text: string;
  /** Milliseconds since the session started (`start()` was called). */
  startMs: number;
  /** Length of the segment in milliseconds. */
  durationMs: number;
  /** 0..1 confidence score where available. */
  confidence?: number;
  /** Per-word alternative text candidates. */
  alternatives?: string[];
}

export interface TranscriptResult {
  /** Unique id for this result. New UUID per emission. */
  id: string;
  /**
   * Stable id shared by every partial + final in one start→stop cycle.
   * Lets you stitch a streaming session together client-side.
   */
  sessionId: string;
  /** Wall-clock time (ms since epoch) when the result reached JS. */
  timestamp: number;

  text: string;
  isFinal: boolean;
  /** 0..1 confidence where available. */
  confidence?: number;
  /** BCP-47 language of the transcript. */
  language?: string;
  /** Alternative transcriptions ranked by confidence. */
  alternatives?: TranscriptAlternative[];
  /** Offset of this result from session start (ms). */
  offsetMs?: number;
  /** Duration of the recognized audio (ms) — iOS only, omitted on Android. */
  durationMs?: number;
  /** Word/phrase-level segments — iOS only, omitted on Android. */
  segments?: TranscriptSegment[];
  /**
   * Speaker label from diarization (e.g. "Guest-1"). Populated only by the
   * Azure engine when `enableSpeakerDiarization` is true.
   */
  speakerId?: string;
}
