import { ClarionError } from '@clarionhq/core';

import type { NativeAudioTapFormat } from './specs/ClarionAudioTap.nitro';

export type AudioTapSampleRate = 16000 | 22050 | 44100 | 48000;
export type AudioTapChannels = 1 | 2;
export type AudioTapFrameDurationMs = 10 | 20 | 50 | 100;

/** JS-friendly options. Mirrors `NativeAudioTapFormat` with sensible defaults. */
export interface AudioTapOptions {
  /** Default 16000 — the lowest common denominator that every STT engine accepts. */
  sampleRate?: AudioTapSampleRate;
  /** Default 1. */
  channels?: AudioTapChannels;
  /** Default 50 ms — balances latency against per-frame overhead. */
  frameDurationMs?: AudioTapFrameDurationMs;
}

export const DEFAULT_AUDIO_TAP_OPTIONS = {
  sampleRate: 16000,
  channels: 1,
  frameDurationMs: 50,
  bitsPerSample: 16,
} as const;

const ALLOWED_SAMPLE_RATES: readonly AudioTapSampleRate[] = [16000, 22050, 44100, 48000];
const ALLOWED_CHANNELS: readonly AudioTapChannels[] = [1, 2];
const ALLOWED_FRAME_DURATIONS: readonly AudioTapFrameDurationMs[] = [10, 20, 50, 100];

/**
 * Normalise user-supplied options into the native format. Throws
 * `INVALID_CONFIG` for any out-of-range value so the failure surfaces in
 * JS, not from a confusing native exception.
 */
export const resolveAudioTapFormat = (
  opts: AudioTapOptions = {},
): NativeAudioTapFormat => {
  const sampleRate = opts.sampleRate ?? DEFAULT_AUDIO_TAP_OPTIONS.sampleRate;
  const channels = opts.channels ?? DEFAULT_AUDIO_TAP_OPTIONS.channels;
  const frameDurationMs = opts.frameDurationMs ?? DEFAULT_AUDIO_TAP_OPTIONS.frameDurationMs;

  if (!ALLOWED_SAMPLE_RATES.includes(sampleRate)) {
    throw invalidConfig('sampleRate', sampleRate, ALLOWED_SAMPLE_RATES);
  }
  if (!ALLOWED_CHANNELS.includes(channels)) {
    throw invalidConfig('channels', channels, ALLOWED_CHANNELS);
  }
  if (!ALLOWED_FRAME_DURATIONS.includes(frameDurationMs)) {
    throw invalidConfig('frameDurationMs', frameDurationMs, ALLOWED_FRAME_DURATIONS);
  }

  return {
    sampleRate,
    channels,
    bitsPerSample: DEFAULT_AUDIO_TAP_OPTIONS.bitsPerSample,
    frameDurationMs,
  };
};

const invalidConfig = (
  field: string,
  got: number,
  allowed: readonly number[],
): ClarionError =>
  new ClarionError({
    code: 'INVALID_CONFIG',
    message: `AudioTap: ${field} must be one of ${allowed.join(', ')} (got ${got}).`,
    where: 'config-validation',
    recoverable: false,
    details: { field, got, allowed: [...allowed] },
  });
