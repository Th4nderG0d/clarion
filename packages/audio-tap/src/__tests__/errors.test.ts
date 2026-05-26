/** Error mapping — both via emitted events (mid-session) and start() rejection. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClarionError } from '@clarionhq/core';

import { AudioTap } from '../index';
import { emitError, fakeNative, resetNativeMock } from './setup';

const live: AudioTap[] = [];
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map((t) => t.release()));
});
const track = (t: AudioTap): AudioTap => {
  live.push(t);
  return t;
};

beforeEach(() => resetNativeMock());

const knownCodes = [
  'PERMISSION_DENIED',
  'PERMISSION_REVOKED',
  'AUDIO_BUSY',
  'AUDIO_SESSION_INTERRUPTED',
  'AUDIO_ROUTE_CHANGED',
  'UNSUPPORTED_FORMAT',
  'INVALID_CONFIG',
  'INVALID_STATE',
  'INTERRUPTED',
  'INTERNAL_ERROR',
] as const;

describe('Native → ClarionError mapping (mid-session)', () => {
  it.each(knownCodes)('preserves %s code', (code) => {
    const tap = track(new AudioTap());
    let captured: ClarionError | null = null;
    tap.onError((e) => {
      captured = e;
    });
    emitError({ code, message: `${code} happened`, recoverable: false });
    expect(captured).not.toBeNull();
    expect((captured as unknown as ClarionError).code).toBe(code);
  });

  it('preserves recoverable flag', () => {
    const tap = track(new AudioTap());
    let captured: ClarionError | null = null;
    tap.onError((e) => {
      captured = e;
    });
    emitError({ code: 'AUDIO_BUSY', recoverable: true });
    expect((captured as unknown as ClarionError).recoverable).toBe(true);
  });

  it('preserves the native message', () => {
    const tap = track(new AudioTap());
    let captured: ClarionError | null = null;
    tap.onError((e) => {
      captured = e;
    });
    emitError({ code: 'AUDIO_BUSY', message: 'mic held by SomeApp.app' });
    expect((captured as unknown as ClarionError).message).toBe('mic held by SomeApp.app');
  });
});

describe('start() rejection mapping', () => {
  it('parses NSError-style structured JSON message', async () => {
    fakeNative.start.mockRejectedValueOnce({
      message: '{"code":"AUDIO_BUSY","message":"mic held"}',
    });
    const tap = track(new AudioTap());
    try {
      await tap.start();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('AUDIO_BUSY');
      expect((err as ClarionError).message).toBe('mic held');
    }
  });

  it('falls back to INTERNAL_ERROR for non-JSON native messages', async () => {
    fakeNative.start.mockRejectedValueOnce(new Error('something exploded'));
    const tap = track(new AudioTap());
    try {
      await tap.start();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('INTERNAL_ERROR');
      expect((err as ClarionError).message).toBe('something exploded');
    }
  });

  it('preserves ClarionError thrown by native unchanged', async () => {
    const original = new ClarionError({
      code: 'PERMISSION_DENIED',
      message: 'user denied',
      where: 'config-validation',
    });
    fakeNative.start.mockRejectedValueOnce(original);
    const tap = track(new AudioTap());
    try {
      await tap.start();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBe(original);
    }
  });
});
