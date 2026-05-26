import { beforeEach, describe, expect, it } from 'vitest';
import { ClarionError } from '@clarionhq/core';

import { AudioTap, resolveAudioTapFormat } from '../index';
import { resetNativeMock } from './setup';

beforeEach(() => resetNativeMock());

describe('resolveAudioTapFormat', () => {
  it('applies defaults when no options passed', () => {
    expect(resolveAudioTapFormat()).toEqual({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      frameDurationMs: 50,
    });
  });

  it.each([16000, 22050, 44100, 48000])('accepts sampleRate %i', (sr) => {
    expect(resolveAudioTapFormat({ sampleRate: sr as 16000 }).sampleRate).toBe(sr);
  });

  it.each([1, 2])('accepts channels %i', (ch) => {
    expect(resolveAudioTapFormat({ channels: ch as 1 }).channels).toBe(ch);
  });

  it.each([10, 20, 50, 100])('accepts frameDurationMs %i', (ms) => {
    expect(resolveAudioTapFormat({ frameDurationMs: ms as 10 }).frameDurationMs).toBe(ms);
  });

  it('throws INVALID_CONFIG for bad sampleRate', () => {
    try {
      resolveAudioTapFormat({ sampleRate: 8000 as 16000 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('INVALID_CONFIG');
      expect((err as ClarionError).details?.field).toBe('sampleRate');
    }
  });

  it('throws INVALID_CONFIG for bad channels', () => {
    try {
      resolveAudioTapFormat({ channels: 3 as 1 });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as ClarionError).code).toBe('INVALID_CONFIG');
      expect((err as ClarionError).details?.field).toBe('channels');
    }
  });

  it('throws INVALID_CONFIG for bad frameDurationMs', () => {
    try {
      resolveAudioTapFormat({ frameDurationMs: 30 as 10 });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as ClarionError).code).toBe('INVALID_CONFIG');
      expect((err as ClarionError).details?.field).toBe('frameDurationMs');
    }
  });
});

describe('AudioTap construction', () => {
  it('throws synchronously on bad config (eager validation)', () => {
    expect(() => new AudioTap({ sampleRate: 8000 as 16000 })).toThrowError(ClarionError);
  });

  it('accepts default config', () => {
    expect(() => new AudioTap()).not.toThrow();
  });
});
