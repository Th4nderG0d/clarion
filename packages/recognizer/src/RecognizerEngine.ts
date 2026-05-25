import {
  ClarionEmitter,
  ClarionError,
  assertTransition,
  fromNativeError,
  validateLanguage,
  type ClarionEngine,
  type ClarionEvent,
  type EngineKind,
  type EngineState,
  type Listener,
  type RecognizerEngineConfig,
  type TranscriptResult,
  type TranscriptSegment,
  type Unsubscribe,
} from '@clarionhq/core';

import { createNativeRecognizer } from './native';
import type {
  ClarionRecognizer,
  NativeRecognizerConfig,
  NativeRecognizerError,
  NativeTranscriptResult,
  NativeTranscriptSegment,
} from './specs/ClarionRecognizer.nitro';

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

const DEFAULT_AUDIO_LEVEL_INTERVAL_MS = 50;
const DEFAULT_LANGUAGE = 'en-US';

export interface RecognizerEngineOptions extends RecognizerEngineConfig {
  /** Emit `audio-level` events for a VU-style meter. Default: false. */
  emitAudioLevel?: boolean;
  /** Throttle in ms for `audio-level` events. Default: 50. */
  audioLevelIntervalMs?: number;
  /** Prefer the on-device model where available (iOS). Default: false. */
  preferOnDevice?: boolean;
}

/**
 * Wraps the platform speech recognizer (SFSpeechRecognizer on iOS,
 * SpeechRecognizer on Android) behind the shared `ClarionEngine` interface.
 *
 * Notes:
 * - Speech recognizers cannot truly pause without losing context, so
 *   `pause()` and `resume()` throw `INVALID_STATE`.
 * - `stop()` returns void to satisfy `ClarionEngine`. The final transcript
 *   is delivered via the `final` event on the emitter.
 */
/**
 * Returns true if the platform speech recognizer is available for the given
 * BCP-47 locale. Use this before `start()` to fail fast with a clear message
 * instead of bubbling a mid-session native error.
 */
export const isRecognizerAvailable = async (
  language: string,
): Promise<boolean> => createNativeRecognizer().isAvailable(language);

/**
 * BCP-47 tags supported by the platform recognizer on this device.
 * iOS: `SFSpeechRecognizer.supportedLocales()`.
 * Android: queried from the system speech service via broadcast.
 */
export const supportedRecognizerLocales = async (): Promise<string[]> =>
  createNativeRecognizer().supportedLocales();

export class RecognizerEngine implements ClarionEngine {
  readonly kind: EngineKind = 'native-recognizer';

  /** See top-level `isRecognizerAvailable`. */
  static isAvailable = isRecognizerAvailable;
  /** See top-level `supportedRecognizerLocales`. */
  static supportedLocales = supportedRecognizerLocales;

  private readonly emitter = new ClarionEmitter();
  private readonly native: ClarionRecognizer;
  private readonly listenerIds: number[] = [];
  private readonly options: RecognizerEngineOptions;

  private currentState: EngineState = 'idle';

  constructor(options: RecognizerEngineOptions = { language: DEFAULT_LANGUAGE }) {
    // Pre-flight: BCP-47 shape check. Throws ClarionError (INVALID_CONFIG)
    // before any native work.
    validateLanguage(options.language);

    this.options = options;
    this.native = createNativeRecognizer();
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
      // Native side fires state='ready' via the state listener.
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

  pause(): Promise<void> {
    return Promise.reject(
      new ClarionError({
        code: 'INVALID_STATE',
        message: 'Recognizer does not support pause — call stop() and start() instead.',
      }),
    );
  }

  resume(): Promise<void> {
    return Promise.reject(
      new ClarionError({
        code: 'INVALID_STATE',
        message: 'Recognizer does not support resume — call start() instead.',
      }),
    );
  }

  async stop(): Promise<void> {
    this.transitionTo('stopping');
    try {
      const result = await this.native.stop();
      this.emitter.emit({
        type: 'final',
        result: this.toTranscriptResult(result),
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
    // Idempotent: double-release is a no-op rather than an error.
    if (this.currentState === 'released') return;
    try {
      this.native.removeAllListeners();
      await this.native.release();
    } catch {
      // release() must never throw — anything here is teardown noise.
    } finally {
      this.listenerIds.length = 0;
      this.emitter.removeAll();
      this.currentState = 'released';
    }
  }

  private buildNativeConfig(): NativeRecognizerConfig {
    return {
      language: this.options.language ?? DEFAULT_LANGUAGE,
      emitPartials: this.options.emitPartials ?? true,
      emitAudioLevel: this.options.emitAudioLevel ?? false,
      audioLevelIntervalMs:
        this.options.audioLevelIntervalMs ?? DEFAULT_AUDIO_LEVEL_INTERVAL_MS,
      preferOnDevice: this.options.preferOnDevice ?? false,
    };
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
      this.native.addPartialListener((result) => {
        this.emitter.emit({
          type: 'partial',
          result: this.toTranscriptResult(result),
        });
      }),
    );

    this.listenerIds.push(
      this.native.addFinalListener((result) => {
        this.emitter.emit({
          type: 'final',
          result: this.toTranscriptResult(result),
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

  private toTranscriptResult(r: NativeTranscriptResult): TranscriptResult {
    const result: TranscriptResult = {
      id: r.id,
      sessionId: r.sessionId,
      timestamp: r.timestamp,
      text: r.text,
      isFinal: r.isFinal,
    };
    if (r.language && r.language.length > 0) result.language = r.language;
    if (r.confidence >= 0) result.confidence = r.confidence;
    if (r.offsetMs >= 0) result.offsetMs = r.offsetMs;
    if (r.durationMs >= 0) result.durationMs = r.durationMs;
    if (r.segments && r.segments.length > 0) {
      result.segments = r.segments.map((s) => this.toTranscriptSegment(s));
    }
    return result;
  }

  private toTranscriptSegment(s: NativeTranscriptSegment): TranscriptSegment {
    const seg: TranscriptSegment = {
      text: s.text,
      startMs: s.startMs,
      durationMs: s.durationMs,
    };
    if (s.confidence >= 0) seg.confidence = s.confidence;
    if (s.alternatives && s.alternatives.length > 0) {
      seg.alternatives = s.alternatives;
    }
    return seg;
  }

  private toClarionError(err: NativeRecognizerError): ClarionError {
    return new ClarionError({
      code: this.mapErrorCode(err.code),
      message: err.message,
      recoverable: err.recoverable,
    });
  }

  private mapErrorCode(code: string): ClarionError['code'] {
    const known: Record<string, ClarionError['code']> = {
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      PERMISSION_REVOKED: 'PERMISSION_REVOKED',
      AUDIO_BUSY: 'AUDIO_BUSY',
      AUDIO_SESSION_INTERRUPTED: 'AUDIO_SESSION_INTERRUPTED',
      AUDIO_ROUTE_CHANGED: 'AUDIO_ROUTE_CHANGED',
      IO_ERROR: 'IO_ERROR',
      INTERRUPTED: 'INTERRUPTED',
      CANCELLED: 'CANCELLED',
      ENGINE_NOT_READY: 'ENGINE_NOT_READY',
      INVALID_STATE: 'INVALID_STATE',
      UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
      NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
      NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
      AUTH_FAILED: 'AUTH_FAILED',
      QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
      UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
      NO_SPEECH: 'NO_SPEECH',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    };
    return known[code] ?? 'UNKNOWN';
  }

  private handleNativeError(err: unknown, where: string): void {
    const error = fromNativeError(err, `Recognizer ${where} failed`);
    this.emitter.emit({ type: 'error', error });
    this.setState('error');
  }
}
