/** Smoke §3: auto-retry — transient errors retry, RETRY_ATTEMPTED warns. */
import { afterEach, describe, expect, it } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { fakeNative, resetNativeMock } from './setup';
import { ClarionError } from '@clarionhq/core';
import type { ClarionEvent, ClarionWarning } from '@clarionhq/core';

const opts = {
  auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
  recognition: { language: 'en-US' },
  advanced: {
    autoRetry: { maxAttempts: 2, baseDelayMs: 10, retryOn: ['NETWORK_DROPPED' as const] },
    skipAuthPreflight: true,
  },
};

let engine: AzureEngine | null = null;
afterEach(async () => {
  await engine?.release();
  engine = null;
  resetNativeMock();
});

describe('autoRetry', () => {
  it('retries a transient prepare() failure and emits RETRY_ATTEMPTED', async () => {
    let attempt = 0;
    fakeNative.prepare.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new ClarionError({
          code: 'NETWORK_DROPPED',
          message: 'Network blip',
          recoverable: true,
        });
      }
    });

    const warnings: ClarionWarning[] = [];
    engine = new AzureEngine(opts);
    engine.on((e: ClarionEvent) => {
      if (e.type === 'warning') warnings.push(e.warning);
    });
    await engine.prepare();
    expect(attempt).toBe(2);
    expect(warnings.some(w => w.code === 'RETRY_ATTEMPTED')).toBe(true);
  });

  it('does not retry a non-retryable error', async () => {
    fakeNative.prepare.mockImplementation(async () => {
      throw new ClarionError({
        code: 'AUTH_FAILED',
        message: 'Auth bad',
      });
    });
    engine = new AzureEngine(opts);
    await expect(engine.prepare()).rejects.toBeDefined();
    expect(fakeNative.prepare).toHaveBeenCalledTimes(1);
  });

  it('surfaces the final error after exhausting maxAttempts', async () => {
    fakeNative.prepare.mockImplementation(async () => {
      throw new ClarionError({
        code: 'NETWORK_DROPPED',
        message: 'still blipping',
        recoverable: true,
      });
    });
    engine = new AzureEngine(opts);
    await expect(engine.prepare()).rejects.toMatchObject({ code: 'NETWORK_DROPPED' });
    // maxAttempts = 2 means 2 retries AFTER the first attempt → 3 total calls.
    expect(fakeNative.prepare).toHaveBeenCalledTimes(3);
  });
});
