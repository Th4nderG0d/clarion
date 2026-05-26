import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClarionError } from '@clarionhq/core';

import { AudioTap } from '../index';
import { emitState, fakeNative, resetNativeMock } from './setup';

const live: AudioTap[] = [];
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map((t) => t.release()));
});
const track = (t: AudioTap): AudioTap => {
  live.push(t);
  return t;
};

beforeEach(() => resetNativeMock());

describe('AudioTap lifecycle', () => {
  it('starts idle', () => {
    const tap = track(new AudioTap());
    expect(tap.state).toBe('idle');
  });

  it('transitions idle → starting → running on start()', async () => {
    const tap = track(new AudioTap());
    const states: string[] = [];
    tap.onState((s) => states.push(s));
    await tap.start();
    expect(tap.state).toBe('running');
    // 'starting' fires synchronously; 'running' after native.start resolves.
    expect(states).toContain('running');
  });

  it('start() is idempotent — second call is a no-op', async () => {
    const tap = track(new AudioTap());
    await tap.start();
    await tap.start();
    expect(fakeNative.start).toHaveBeenCalledTimes(1);
  });

  it('forwards format to native', async () => {
    const tap = track(new AudioTap({ sampleRate: 48000, channels: 2, frameDurationMs: 20 }));
    await tap.start();
    expect(fakeNative.start).toHaveBeenCalledWith({
      sampleRate: 48000,
      channels: 2,
      bitsPerSample: 16,
      frameDurationMs: 20,
    });
  });

  it('transitions to idle on stop()', async () => {
    const tap = track(new AudioTap());
    await tap.start();
    await tap.stop();
    expect(tap.state).toBe('idle');
  });

  it('stop() is idempotent', async () => {
    const tap = track(new AudioTap());
    await tap.start();
    await tap.stop();
    await tap.stop();
    expect(fakeNative.stop).toHaveBeenCalledTimes(1);
  });

  it('release() transitions to released and prevents further use', async () => {
    const tap = track(new AudioTap());
    await tap.start();
    await tap.release();
    expect(tap.state).toBe('released');
    await expect(tap.start()).rejects.toBeInstanceOf(ClarionError);
  });

  it('release() removes all native listeners', async () => {
    const tap = track(new AudioTap());
    await tap.release();
    expect(fakeNative.removeAllListeners).toHaveBeenCalled();
  });

  it('native errors propagate as ClarionError with mapped code', async () => {
    fakeNative.start.mockRejectedValueOnce({
      message: '{"code":"PERMISSION_DENIED","message":"Mic denied"}',
    });
    const tap = track(new AudioTap());
    try {
      await tap.start();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('PERMISSION_DENIED');
    }
    expect(tap.state).toBe('error');
  });

  it('reflects native state events into JS state listener', () => {
    const tap = track(new AudioTap());
    const seen: string[] = [];
    tap.onState((s) => seen.push(s));
    emitState('running');
    emitState('stopping');
    expect(seen).toEqual(['running', 'stopping']);
  });

  it('onState returns an idempotent unsubscribe', () => {
    const tap = track(new AudioTap());
    const seen: string[] = [];
    const off = tap.onState((s) => seen.push(s));
    emitState('running');
    off();
    off();  // second call is safe
    emitState('stopping');
    expect(seen).toEqual(['running']);
  });
});
