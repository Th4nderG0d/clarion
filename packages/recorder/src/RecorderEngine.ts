import {
  ClarionEmitter,
  ClarionError,
  DEFAULT_AUDIO_FORMAT,
  assertTransition,
  type ClarionEngine,
  type ClarionEvent,
  type EngineKind,
  type EngineState,
  type Listener,
  type RecorderEngineConfig,
  type RecorderResult,
  type Unsubscribe,
} from '@clarionhq/core';

import { createNativeRecorder } from './native';
import type {
  ClarionRecorder,
  NativeRecorderConfig,
  NativeRecorderError,
  NativeRecorderResult,
} from './specs/ClarionRecorder.nitro';

const VALID_STATES: readonly EngineState[] = [
  'idle',
  'preparing',
  'ready',
  'starting',
  'recording',
  'paused',
  'stopping',
  'error',
  'released',
];

const isEngineState = (s: string): s is EngineState =>
  (VALID_STATES as readonly string[]).includes(s);

// 32 kbps is the highest AAC-LC bitrate universally supported across iOS
// (Simulator + device) and Android for 16 kHz mono. Higher bitrates work
// on Android but iOS's AAC encoder rejects them with
// kAudioFormatUnsupportedDataFormatError. Callers can override for higher
// sample rates / stereo where larger values are accepted.
const DEFAULT_AAC_BITRATE = 32_000;
const DEFAULT_AUDIO_LEVEL_INTERVAL_MS = 50;

export interface RecorderEngineOptions extends RecorderEngineConfig {
  aacBitrate?: number;
}

export class RecorderEngine implements ClarionEngine {
  readonly kind: EngineKind = 'recorder';

  private readonly emitter = new ClarionEmitter();
  private readonly native: ClarionRecorder;
  private readonly listenerIds: number[] = [];
  private readonly options: RecorderEngineOptions;

  private currentState: EngineState = 'idle';

  constructor(options: RecorderEngineOptions = {}) {
    this.options = options;
    this.native = createNativeRecorder();
    this.bindNativeListeners();
  }

  get state(): EngineState {
    return this.currentState;
  }

  on(listener: Listener<ClarionEvent>): Unsubscribe {
    return this.emitter.on(listener);
  }

  async prepare(): Promise<void> {
    this.transitionTo('preparing');
    try {
      const config = this.buildNativeConfig();
      await this.native.prepare(config);
      // Native side fires state='ready' via the state listener — no JS-side transition needed.
    } catch (err) {
      this.handleNativeError(err, 'prepare');
      throw err;
    }
  }

  async start(): Promise<void> {
    // Auto-recover from a previous error — caller can retry without manual reset.
    if (this.currentState === 'error') {
      this.setState('idle');
    }
    // Auto-prepare if no session yet — callers don't need to know about prepare().
    if (this.currentState === 'idle') {
      await this.prepare();
    }
    if (this.currentState !== 'ready') {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message: `Cannot start from state '${this.currentState}'`,
      });
    }
    this.transitionTo('starting');
    try {
      await this.native.start();
      // Native side fires state='recording' via the state listener.
    } catch (err) {
      this.handleNativeError(err, 'start');
      throw err;
    }
  }

  async pause(): Promise<void> {
    if (this.currentState !== 'recording') {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message: `Cannot pause from state '${this.currentState}'`,
      });
    }
    try {
      await this.native.pause();
    } catch (err) {
      this.handleNativeError(err, 'pause');
      throw err;
    }
  }

  async resume(): Promise<void> {
    if (this.currentState !== 'paused') {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message: `Cannot resume from state '${this.currentState}'`,
      });
    }
    try {
      await this.native.resume();
    } catch (err) {
      this.handleNativeError(err, 'resume');
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.transitionTo('stopping');
    try {
      const result = await this.native.stop();
      this.emitter.emit({
        type: 'recording-complete',
        result: this.toRecorderResult(result),
      });
    } catch (err) {
      this.handleNativeError(err, 'stop');
      throw err;
    }
  }

  async discard(): Promise<void> {
    try {
      await this.native.discard();
    } catch (err) {
      this.handleNativeError(err, 'discard');
      throw err;
    }
  }

  async release(): Promise<void> {
    try {
      this.native.removeAllListeners();
      await this.native.release();
    } finally {
      this.listenerIds.length = 0;
      this.emitter.removeAll();
      this.currentState = 'released';
    }
  }

  private buildNativeConfig(): NativeRecorderConfig {
    const format = DEFAULT_AUDIO_FORMAT;
    const cfg: NativeRecorderConfig = {
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitDepth: format.bitDepth,
      emitAudioLevel: this.options.emitAudioLevel ?? false,
      audioLevelIntervalMs:
        this.options.audioLevelIntervalMs ?? DEFAULT_AUDIO_LEVEL_INTERVAL_MS,
      aacBitrate: this.options.aacBitrate ?? DEFAULT_AAC_BITRATE,
    };
    if (this.options.outputDirectory !== undefined) {
      cfg.outputDirectory = this.options.outputDirectory;
    }
    if (this.options.filenamePrefix !== undefined) {
      cfg.filenamePrefix = this.options.filenamePrefix;
    }
    if (this.options.rotateAfterMs !== undefined) {
      cfg.rotateAfterMs = this.options.rotateAfterMs;
    }
    return cfg;
  }

  private bindNativeListeners(): void {
    this.listenerIds.push(
      this.native.addStateListener((nativeState) => {
        if (!isEngineState(nativeState)) return;
        this.setState(nativeState);
      }),
    );

    this.listenerIds.push(
      this.native.addAudioLevelListener((rms, peak) => {
        this.emitter.emit({ type: 'audio-level', rms, peak });
      }),
    );

    this.listenerIds.push(
      this.native.addChunkListener((uri, startMs, endMs, sizeBytes) => {
        this.emitter.emit({
          type: 'chunk',
          uri,
          startMs,
          endMs,
          sizeBytes,
        });
      }),
    );

    this.listenerIds.push(
      this.native.addErrorListener((err) => {
        this.emitter.emit({
          type: 'error',
          error: this.toClarionError(err),
        });
      }),
    );
  }

  private transitionTo(next: EngineState): void {
    if (this.currentState === next) return;
    assertTransition(this.currentState, next);
    this.setState(next);
  }

  private setState(next: EngineState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.emitter.emit({ type: 'state', state: next });
  }

  private toRecorderResult(r: NativeRecorderResult): RecorderResult {
    return {
      uri: r.uri,
      durationMs: r.durationMs,
      sizeBytes: r.sizeBytes,
      container: 'm4a',
      audioFormat: {
        sampleRate: r.sampleRate as RecorderResult['audioFormat']['sampleRate'],
        channels: r.channels as RecorderResult['audioFormat']['channels'],
        bitDepth: r.bitDepth as RecorderResult['audioFormat']['bitDepth'],
      },
    };
  }

  private toClarionError(err: NativeRecorderError): ClarionError {
    return new ClarionError({
      code: this.mapErrorCode(err.code),
      message: err.message,
      recoverable: err.recoverable,
    });
  }

  private mapErrorCode(
    code: string,
  ): ClarionError['code'] {
    const known: Record<string, ClarionError['code']> = {
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      AUDIO_BUSY: 'AUDIO_BUSY',
      IO_ERROR: 'IO_ERROR',
      INTERRUPTED: 'INTERRUPTED',
      CANCELLED: 'CANCELLED',
      ENGINE_NOT_READY: 'ENGINE_NOT_READY',
      INVALID_STATE: 'INVALID_STATE',
      UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    };
    return known[code] ?? 'UNKNOWN';
  }

  private handleNativeError(err: unknown, where: string): void {
    const error =
      err instanceof ClarionError
        ? err
        : new ClarionError({
            code: 'INTERNAL_ERROR',
            message: `Recorder ${where} failed: ${String(err)}`,
            cause: err,
          });
    this.emitter.emit({ type: 'error', error });
    this.setState('error');
  }
}
