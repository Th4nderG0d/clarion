/** Smoke §13: rapid stop/start cycles — no leaks, no crashes. */
import { afterEach, describe, expect, it } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { emitState, fakeNative, resetNativeMock } from './setup';

const opts = {
  auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
  recognition: { language: 'en-US' },
  advanced: { skipAuthPreflight: true },
};

let engine: AzureEngine | null = null;
afterEach(async () => {
  await engine?.release();
  engine = null;
  resetNativeMock();
});

describe('rapid stop/start cycles', () => {
  it('survives 20 start/stop loops without throwing', async () => {
    engine = new AzureEngine(opts);
    // Auto-fire state=ready after each prepare call so start() passes the state guard.
    fakeNative.prepare.mockImplementation(async () => {
      queueMicrotask(() => emitState('ready'));
    });
    fakeNative.start.mockImplementation(async () => {
      queueMicrotask(() => emitState('recording'));
    });
    fakeNative.stop.mockImplementation(async () => {
      queueMicrotask(() => emitState('idle'));
      return {
        id: 'session', text: '', timestamp: 0, confidence: 1, isFinal: true,
        language: 'en-US', segments: [], speakerId: '', durationMs: 0, offsetMs: 0,
      };
    });

    for (let i = 0; i < 20; i++) {
      await engine.start();
      await engine.stop();
    }

    expect(fakeNative.start).toHaveBeenCalledTimes(20);
    expect(fakeNative.stop).toHaveBeenCalledTimes(20);
  });

  it('release() is idempotent', async () => {
    engine = new AzureEngine(opts);
    await engine.release();
    await engine.release(); // second call must not throw
    await engine.release();
    // Counted at most once on the native side since subsequent calls short-circuit.
    expect(fakeNative.release.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
