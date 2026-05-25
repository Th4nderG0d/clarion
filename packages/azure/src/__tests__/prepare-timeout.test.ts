/** Smoke §4: prepareTimeoutMs — hanging native prepare surfaces NETWORK_TIMEOUT. */
import { afterEach, describe, expect, it } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { fakeNative, resetNativeMock } from './setup';

const opts = {
  auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
  recognition: { language: 'en-US' },
  advanced: { prepareTimeoutMs: 50, skipAuthPreflight: true },
};

let engine: AzureEngine | null = null;
afterEach(async () => {
  await engine?.release();
  engine = null;
  resetNativeMock();
});

describe('prepareTimeoutMs', () => {
  it('rejects with NETWORK_TIMEOUT when native prepare hangs past the budget', async () => {
    fakeNative.prepare.mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );
    engine = new AzureEngine(opts);
    await expect(engine.prepare()).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      where: 'prepare',
    });
  });

  it('does not time out when prepare resolves under the budget', async () => {
    fakeNative.prepare.mockImplementation(
      () => new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), 10); }),
    );
    engine = new AzureEngine(opts);
    await expect(engine.prepare()).resolves.toBeUndefined();
  });
});
