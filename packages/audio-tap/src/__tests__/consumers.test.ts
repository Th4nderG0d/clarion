import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClarionWarning } from '@clarionhq/core';

import { AudioTap, type AudioTapFrame } from '../index';
import { emitError, emitFrame, resetNativeMock } from './setup';

const live: AudioTap[] = [];
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map((t) => t.release()));
});
const track = (t: AudioTap): AudioTap => {
  live.push(t);
  return t;
};

beforeEach(() => resetNativeMock());

describe('AudioTap consumers', () => {
  it('attach() registers a consumer and returns a detach handle', () => {
    const tap = track(new AudioTap());
    const onFrame = vi.fn();
    const detach = tap.attach({ id: 'a', onFrame });
    expect(tap.consumerCount).toBe(1);
    emitFrame();
    expect(onFrame).toHaveBeenCalledTimes(1);
    detach();
    expect(tap.consumerCount).toBe(0);
    emitFrame();
    expect(onFrame).toHaveBeenCalledTimes(1);  // not called after detach
  });

  it('detach() is idempotent', () => {
    const tap = track(new AudioTap());
    const detach = tap.attach({ id: 'a', onFrame: vi.fn() });
    detach();
    detach();
    expect(tap.consumerCount).toBe(0);
  });

  it('fans out one frame to multiple consumers', () => {
    const tap = track(new AudioTap());
    const a = vi.fn();
    const b = vi.fn();
    tap.attach({ id: 'a', onFrame: a });
    tap.attach({ id: 'b', onFrame: b });
    emitFrame();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a consumer throwing in onFrame does not crash others', () => {
    const tap = track(new AudioTap());
    const good = vi.fn();
    tap.attach({
      id: 'bad',
      onFrame: () => {
        throw new Error('boom');
      },
    });
    tap.attach({ id: 'good', onFrame: good });
    expect(() => emitFrame()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('consumer throws are surfaced as warnings', () => {
    const tap = track(new AudioTap());
    const warnings: ClarionWarning[] = [];
    tap.onWarning((w) => warnings.push(w));
    tap.attach({
      id: 'bad',
      onFrame: () => {
        throw new Error('boom');
      },
    });
    emitFrame();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('"bad"');
  });

  it('skips dispatch when no consumers are attached', () => {
    const tap = track(new AudioTap());
    // Should not throw or otherwise misbehave.
    expect(() => emitFrame()).not.toThrow();
  });

  it('forwards frame data verbatim to consumer (no mutation)', () => {
    const tap = track(new AudioTap());
    let received: AudioTapFrame | null = null;
    tap.attach({
      id: 'a',
      onFrame: (frame) => {
        received = frame;
      },
    });
    const pcm = new ArrayBuffer(1600);
    emitFrame({ pcm, timestamp: 123, frameIndex: 7, sampleRate: 48000 });
    expect(received).not.toBeNull();
    const r = received as unknown as AudioTapFrame;
    expect(r.pcm).toBe(pcm);
    expect(r.timestamp).toBe(123);
    expect(r.frameIndex).toBe(7);
    expect(r.sampleRate).toBe(48000);
  });

  it('forwards native errors to consumer.onError when provided', () => {
    const tap = track(new AudioTap());
    const onError = vi.fn();
    tap.attach({ id: 'a', onFrame: vi.fn(), onError });
    emitError({ code: 'AUDIO_BUSY', message: 'mic held', recoverable: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]?.code).toBe('AUDIO_BUSY');
  });

  it('consumer.onError throw does not crash the tap', () => {
    const tap = track(new AudioTap());
    tap.attach({
      id: 'a',
      onFrame: vi.fn(),
      onError: () => {
        throw new Error('boom');
      },
    });
    expect(() => emitError()).not.toThrow();
  });
});
