/** Smoke §7: singleton lock — second engine without release() throws. */
import { afterEach, describe, expect, it } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { ClarionError } from '@clarionhq/core';
import { resetNativeMock } from './setup';

const validOpts = {
  auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
  recognition: { language: 'en-US' },
};

let alive: AzureEngine[] = [];
afterEach(async () => {
  await Promise.allSettled(alive.map(e => e.release()));
  alive = [];
  resetNativeMock();
});

describe('AzureEngine singleton lock', () => {
  it('throws INVALID_STATE on the second concurrent instance', () => {
    const a = new AzureEngine(validOpts);
    alive.push(a);
    try {
      const b = new AzureEngine(validOpts);
      alive.push(b);
      throw new Error('expected second construction to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('INVALID_STATE');
    }
  });

  it('lets a new instance be constructed after release()', async () => {
    const a = new AzureEngine(validOpts);
    await a.release();
    const b = new AzureEngine(validOpts);
    alive.push(b);
    expect(b).toBeInstanceOf(AzureEngine);
  });

  it('honours advanced.allowMultipleInstances = true', () => {
    const opts = { ...validOpts, advanced: { allowMultipleInstances: true } };
    const a = new AzureEngine(opts);
    const b = new AzureEngine(opts);
    alive.push(a, b);
    expect(b).toBeInstanceOf(AzureEngine);
  });
});
