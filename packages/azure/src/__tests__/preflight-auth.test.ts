/** Pre-flight auth: maps Azure /issueToken response codes to ClarionError shapes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { ClarionError } from '@clarionhq/core';
import { resetNativeMock } from './setup';

const baseOpts = {
  auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
  recognition: { language: 'en-US' },
};

let engine: AzureEngine | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(async () => {
  await engine?.release();
  engine = null;
  globalThis.fetch = originalFetch;
  resetNativeMock();
});

const mockFetchStatus = (status: number): void => {
  fetchMock.mockResolvedValue(new Response(null, { status }));
};

describe('preflightAuth', () => {
  it('maps 200 → no throw (key valid)', async () => {
    mockFetchStatus(200);
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).resolves.toBeUndefined();
  });

  it('maps 401 → AUTH_FAILED', async () => {
    mockFetchStatus(401);
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      where: 'prepare',
    });
  });

  it('maps 403 → AUTH_FAILED', async () => {
    mockFetchStatus(403);
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('maps 404 → INVALID_CONFIG (region not found)', async () => {
    mockFetchStatus(404);
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('maps 429 → QUOTA_EXCEEDED with retryAfterMs hint', async () => {
    mockFetchStatus(429);
    engine = new AzureEngine(baseOpts);
    try {
      await engine.prepare();
      throw new Error('expected to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ClarionError);
      expect((err as ClarionError).code).toBe('QUOTA_EXCEEDED');
      expect((err as ClarionError).retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('maps 503 → SERVICE_DOWN (recoverable)', async () => {
    mockFetchStatus(503);
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).rejects.toMatchObject({
      code: 'SERVICE_DOWN',
      recoverable: true,
    });
  });

  it('maps fetch network throw → NETWORK_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    engine = new AzureEngine(baseOpts);
    await expect(engine.prepare()).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
    });
  });

  it('skips pre-flight when advanced.skipAuthPreflight is true', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 })); // would fail otherwise
    engine = new AzureEngine({
      ...baseOpts,
      advanced: { skipAuthPreflight: true },
    });
    await expect(engine.prepare()).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips pre-flight for tokenProvider auth (no subscription key)', async () => {
    engine = new AzureEngine({
      auth: {
        tokenProvider: async () => 'fake-token-' + 'x'.repeat(20),
        region: 'eastus',
      },
      recognition: { language: 'en-US' },
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(engine.prepare()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a successful pre-flight by (key, region) for repeat prepare() calls', async () => {
    mockFetchStatus(200);
    engine = new AzureEngine(baseOpts);
    await engine.prepare();
    await engine.discard();
    await engine.prepare(); // second prepare — cache hit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
