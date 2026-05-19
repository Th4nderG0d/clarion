import type { ClarionError } from './errors';
import type { RecorderResult, TranscriptResult } from './results';
import type { EngineState } from './state';

export type ClarionEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'audio-level'; rms: number; peak: number }
  | { type: 'partial'; result: TranscriptResult }
  | { type: 'final'; result: TranscriptResult }
  | { type: 'chunk'; uri: string; startMs: number; endMs: number; sizeBytes: number }
  | { type: 'recording-complete'; result: RecorderResult }
  | { type: 'error'; error: ClarionError };

export type ClarionEventType = ClarionEvent['type'];

export type Listener<T> = (event: T) => void;
export type Unsubscribe = () => void;
