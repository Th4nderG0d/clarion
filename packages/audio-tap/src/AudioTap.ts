import { ClarionError, type ClarionWarning, type ErrorCode } from '@clarionhq/core';

import { resolveAudioTapFormat, type AudioTapOptions } from './AudioTapConfig';
import { createNativeAudioTap } from './native';
import type {
  ClarionAudioTap,
  NativeAudioTapError,
  NativeAudioTapFrame,
  NativeAudioTapStats,
} from './specs/ClarionAudioTap.nitro';

export type AudioTapState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'released'
  | 'error';

/** Wire-format frame the consumer receives. Pure data, no methods. */
export interface AudioTapFrame {
  pcm: ArrayBuffer;
  timestamp: number;
  frameIndex: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface AudioTapStats {
  uptimeMs: number;
  framesEmitted: number;
  framesDropped: number;
  consumerCount: number;
  bufferFillPct: number;
}

/**
 * A PCM consumer. The tap dispatches every frame to every attached consumer.
 * `id` is for diagnostics only — multiple consumers may share an id but it's
 * useful to have it unique when debugging.
 */
export interface AudioTapConsumer {
  readonly id: string;
  onFrame(frame: AudioTapFrame): void;
  onError?(error: ClarionError): void;
}

/**
 * Detach handle returned by `attach`. Idempotent — safe to call more than once.
 */
export type DetachConsumer = () => void;

/**
 * JS-facing wrapper around the native `ClarionAudioTap` HybridObject.
 *
 *   const tap = new AudioTap({ sampleRate: 16000, frameDurationMs: 50 });
 *   const detach = tap.attach({
 *     id: 'recorder',
 *     onFrame: (frame) => recorder.feedPcm(frame.pcm),
 *   });
 *   await tap.start();
 *   …
 *   detach();
 *   await tap.stop();
 *   await tap.release();
 */
export class AudioTap {
  private native: ClarionAudioTap | null;
  private consumers = new Map<string, AudioTapConsumer>();
  private nativeListenerIds: number[] = [];
  private warningListeners = new Set<(w: ClarionWarning) => void>();
  private errorListeners = new Set<(e: ClarionError) => void>();
  private stateListeners = new Set<(s: AudioTapState) => void>();
  private statsListeners = new Set<(s: AudioTapStats) => void>();
  private currentState: AudioTapState = 'idle';

  constructor(private readonly opts: AudioTapOptions = {}) {
    // Validate eagerly so a bad config throws at construction, not start().
    resolveAudioTapFormat(opts);
    this.native = createNativeAudioTap();
    this.wireNativeListeners();
  }

  get state(): AudioTapState {
    return this.currentState;
  }

  get consumerCount(): number {
    return this.consumers.size;
  }

  /** Open the mic with the configured format. */
  async start(): Promise<void> {
    this.assertUsable();
    if (this.currentState === 'running' || this.currentState === 'starting') return;
    const format = resolveAudioTapFormat(this.opts);
    this.setState('starting');
    try {
      await this.native!.start(format);
      this.setState('running');
    } catch (err) {
      this.setState('error');
      throw this.mapNativeError(err);
    }
  }

  /** Close the mic. Safe to call from any state. */
  async stop(): Promise<void> {
    if (!this.native) return;
    if (this.currentState === 'idle' || this.currentState === 'stopping') return;
    this.setState('stopping');
    try {
      await this.native.stop();
      this.setState('idle');
    } catch (err) {
      this.setState('error');
      throw this.mapNativeError(err);
    }
  }

  /** Release all native resources. Tap is unusable after this. */
  async release(): Promise<void> {
    if (!this.native) return;
    try {
      await this.native.release();
    } catch {
      // Swallow — release should not throw.
    }
    this.native.removeAllListeners();
    this.native = null;
    this.consumers.clear();
    this.nativeListenerIds = [];
    this.setState('released');
  }

  /** Attach a PCM consumer. Returns an idempotent detach function. */
  attach(consumer: AudioTapConsumer): DetachConsumer {
    this.assertUsable();
    this.consumers.set(consumer.id, consumer);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.consumers.delete(consumer.id);
    };
  }

  onState(listener: (state: AudioTapState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onStats(listener: (stats: AudioTapStats) => void): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  onWarning(listener: (warning: ClarionWarning) => void): () => void {
    this.warningListeners.add(listener);
    return () => this.warningListeners.delete(listener);
  }

  onError(listener: (error: ClarionError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private wireNativeListeners(): void {
    const n = this.native;
    if (!n) return;
    this.nativeListenerIds.push(
      n.addFrameListener((frame) => this.dispatchFrame(frame)),
      n.addStateListener((state) => this.setState(state as AudioTapState)),
      n.addStatsListener((stats) => this.dispatchStats(stats)),
      n.addErrorListener((err) => this.dispatchError(err)),
    );
  }

  private dispatchFrame(frame: NativeAudioTapFrame): void {
    if (this.consumers.size === 0) return;
    const wire: AudioTapFrame = {
      pcm: frame.pcm,
      timestamp: frame.timestamp,
      frameIndex: frame.frameIndex,
      sampleRate: frame.sampleRate,
      channels: frame.channels,
      bitsPerSample: frame.bitsPerSample,
    };
    for (const consumer of this.consumers.values()) {
      try {
        consumer.onFrame(wire);
      } catch (err) {
        // A consumer threw — surface as a warning, keep dispatching to the rest.
        this.notifyWarning({
          code: 'UNKNOWN',
          message: `AudioTap consumer "${consumer.id}" threw in onFrame: ${
            err instanceof Error ? err.message : String(err)
          }`,
          details: { consumerId: consumer.id },
        });
      }
    }
  }

  private dispatchStats(stats: NativeAudioTapStats): void {
    const wire: AudioTapStats = {
      uptimeMs: stats.uptimeMs,
      framesEmitted: stats.framesEmitted,
      framesDropped: stats.framesDropped,
      consumerCount: this.consumers.size,
      bufferFillPct: stats.bufferFillPct,
    };
    for (const listener of this.statsListeners) {
      try {
        listener(wire);
      } catch {
        // Stats listeners are advisory — never crash on their errors.
      }
    }
  }

  private dispatchError(native: NativeAudioTapError): void {
    const err = new ClarionError({
      code: toErrorCode(native.code),
      message: native.message,
      where: 'mid-session',
      recoverable: native.recoverable,
      details: { source: 'native-audio-tap', nativeErrorCode: native.code },
    });
    for (const consumer of this.consumers.values()) {
      try {
        consumer.onError?.(err);
      } catch {
        // Consumer error handlers must not crash the tap.
      }
    }
    for (const listener of this.errorListeners) {
      try {
        listener(err);
      } catch {
        // Same.
      }
    }
  }

  private setState(next: AudioTapState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    for (const listener of this.stateListeners) {
      try {
        listener(next);
      } catch {
        // State listeners are advisory.
      }
    }
  }

  private notifyWarning(w: ClarionWarning): void {
    for (const listener of this.warningListeners) {
      try {
        listener(w);
      } catch {
        // Warning listeners must not throw.
      }
    }
  }

  private mapNativeError(err: unknown): ClarionError {
    if (err instanceof ClarionError) return err;
    // Pull `.message` from anything that has one — Nitro rejections cross the
    // bridge as plain objects, not Error instances, so `instanceof Error` fails.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : String(err);
    const parsed = tryParseStructured(message);
    if (parsed) {
      return new ClarionError({
        code: toErrorCode(parsed.code),
        message: parsed.message,
        where: 'start',
        recoverable: false,
        details: { source: 'native-audio-tap', nativeErrorCode: parsed.code },
      });
    }
    return new ClarionError({
      code: 'INTERNAL_ERROR',
      message,
      where: 'start',
      recoverable: false,
      details: { source: 'native-audio-tap' },
    });
  }

  private assertUsable(): void {
    if (!this.native || this.currentState === 'released') {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message: 'AudioTap has been released and can no longer be used.',
        where: 'config-validation',
        recoverable: false,
      });
    }
  }
}

/**
 * Map a native error string to a `core` ErrorCode. Unknown codes degrade
 * to `INTERNAL_ERROR` so the user still gets a typed error.
 */
const toErrorCode = (code: string): ErrorCode => {
  switch (code) {
    case 'PERMISSION_DENIED':
    case 'PERMISSION_REVOKED':
    case 'AUDIO_BUSY':
    case 'AUDIO_SESSION_INTERRUPTED':
    case 'AUDIO_ROUTE_CHANGED':
    case 'UNSUPPORTED_FORMAT':
    case 'INVALID_CONFIG':
    case 'INVALID_STATE':
    case 'INTERRUPTED':
    case 'INTERNAL_ERROR':
      return code;
    default:
      return 'INTERNAL_ERROR';
  }
};

const tryParseStructured = (
  message: string,
): { code: string; message: string } | null => {
  // Native may throw NSError/Java exceptions whose .message is JSON.
  if (!message.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(message) as { code?: unknown; message?: unknown };
    if (typeof parsed.code !== 'string' || typeof parsed.message !== 'string') return null;
    return { code: parsed.code, message: parsed.message };
  } catch {
    return null;
  }
};
