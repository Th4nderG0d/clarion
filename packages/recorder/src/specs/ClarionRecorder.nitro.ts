import type { HybridObject } from 'react-native-nitro-modules';

export interface NativeRecorderConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  outputDirectory?: string;
  filenamePrefix?: string;
  rotateAfterMs?: number;
  emitAudioLevel: boolean;
  audioLevelIntervalMs: number;
  aacBitrate: number;
}

export interface NativeRecorderResult {
  uri: string;
  durationMs: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export interface NativeRecorderError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type StateListener = (state: string) => void;
export type AudioLevelListener = (rms: number, peak: number) => void;
export type ChunkListener = (
  uri: string,
  startMs: number,
  endMs: number,
  sizeBytes: number,
) => void;
export type ErrorListener = (error: NativeRecorderError) => void;

export interface ClarionRecorder
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly state: string;

  prepare(config: NativeRecorderConfig): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<NativeRecorderResult>;
  discard(): Promise<void>;
  release(): Promise<void>;

  addStateListener(listener: StateListener): number;
  addAudioLevelListener(listener: AudioLevelListener): number;
  addChunkListener(listener: ChunkListener): number;
  addErrorListener(listener: ErrorListener): number;
  removeListener(id: number): void;
  removeAllListeners(): void;
}
