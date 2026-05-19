import type { ClarionEvent, Listener, Unsubscribe } from './events';
import type { EngineKind, EngineState } from './state';

export interface ClarionEngine {
  readonly kind: EngineKind;
  readonly state: EngineState;

  prepare(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  discard(): Promise<void>;
  release(): Promise<void>;

  on(listener: Listener<ClarionEvent>): Unsubscribe;
}

export interface RecorderEngineConfig {
  outputDirectory?: string;
  filenamePrefix?: string;
  rotateAfterMs?: number;
  emitAudioLevel?: boolean;
  audioLevelIntervalMs?: number;
}

export interface RecognizerEngineConfig {
  language: string;
  emitPartials?: boolean;
  maxAlternatives?: number;
}

export interface AzureEngineConfig extends RecognizerEngineConfig {
  subscriptionKey?: string;
  region?: string;
  authToken?: string;
  endpoint?: string;
}

export interface HybridEngineConfig {
  online: AzureEngineConfig;
  offline: RecorderEngineConfig;
  preferAzureWhen: 'always-if-online' | 'on-good-network';
  retainOfflineCopy?: boolean;
}
