import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClarionError, ClarionWarning } from '@clarionhq/core';

import { AudioTap, type AudioTapStats } from '../index';
import { emitError, emitStats, resetNativeMock } from './setup';

const live: AudioTap[] = [];
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map((t) => t.release()));
});
const track = (t: AudioTap): AudioTap => {
  live.push(t);
  return t;
};

beforeEach(() => resetNativeMock());

describe('AudioTap subscriptions', () => {
  it('onStats forwards native stats and overrides consumerCount', () => {
    const tap = track(new AudioTap());
    tap.attach({ id: 'a', onFrame: vi.fn() });
    tap.attach({ id: 'b', onFrame: vi.fn() });
    const seen: AudioTapStats[] = [];
    tap.onStats((s) => seen.push(s));
    emitStats({ uptimeMs: 5000, framesEmitted: 100, framesDropped: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.uptimeMs).toBe(5000);
    expect(seen[0]?.framesEmitted).toBe(100);
    expect(seen[0]?.framesDropped).toBe(2);
    // consumerCount comes from the JS-side consumer map, not the native payload.
    expect(seen[0]?.consumerCount).toBe(2);
  });

  it('onError converts native error → ClarionError with mapped code', () => {
    const tap = track(new AudioTap());
    const errors: ClarionError[] = [];
    tap.onError((e) => errors.push(e));
    emitError({ code: 'AUDIO_SESSION_INTERRUPTED', message: 'phone call', recoverable: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('AUDIO_SESSION_INTERRUPTED');
    expect(errors[0]?.recoverable).toBe(true);
    expect(errors[0]?.details?.source).toBe('native-audio-tap');
  });

  it('unknown native code degrades to INTERNAL_ERROR', () => {
    const tap = track(new AudioTap());
    const errors: ClarionError[] = [];
    tap.onError((e) => errors.push(e));
    emitError({ code: 'SOME_NEW_CODE', message: 'wat', recoverable: false });
    expect(errors[0]?.code).toBe('INTERNAL_ERROR');
    expect(errors[0]?.details?.nativeErrorCode).toBe('SOME_NEW_CODE');
  });

  it('onStats returns an idempotent unsubscribe', () => {
    const tap = track(new AudioTap());
    const seen: AudioTapStats[] = [];
    const off = tap.onStats((s) => seen.push(s));
    emitStats();
    off();
    off();
    emitStats();
    expect(seen).toHaveLength(1);
  });

  it('onError returns an idempotent unsubscribe', () => {
    const tap = track(new AudioTap());
    const errors: ClarionError[] = [];
    const off = tap.onError((e) => errors.push(e));
    emitError();
    off();
    off();
    emitError();
    expect(errors).toHaveLength(1);
  });

  it('onWarning unsubscribe works', () => {
    const tap = track(new AudioTap());
    const warnings: ClarionWarning[] = [];
    const off = tap.onWarning((w) => warnings.push(w));
    tap.attach({
      id: 'bad',
      onFrame: () => {
        throw new Error('boom');
      },
    });
    const emitFrameFromSetup = async () => {
      const { emitFrame } = await import('./setup');
      emitFrame();
    };
    return emitFrameFromSetup().then(() => {
      expect(warnings).toHaveLength(1);
      off();
      return emitFrameFromSetup();
    }).then(() => {
      expect(warnings).toHaveLength(1);  // no second warning after off()
    });
  });

  it('multiple subscribers all receive events', () => {
    const tap = track(new AudioTap());
    const a = vi.fn();
    const b = vi.fn();
    tap.onError(a);
    tap.onError(b);
    emitError();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
