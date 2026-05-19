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
  confidence: number;
}

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
  alternatives?: TranscriptAlternative[];
  offsetMs?: number;
  durationMs?: number;
}
