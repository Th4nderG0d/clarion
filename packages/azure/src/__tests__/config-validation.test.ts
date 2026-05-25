/** Smoke §1: config validation — bad inputs fail fast at construction. */
import { afterEach, describe, it, expect } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import { ClarionError } from '@clarionhq/core';

const validRecognition = { language: 'en-US' };

const live: AzureEngine[] = [];
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map(e => e.release()));
});

const track = (e: AzureEngine): AzureEngine => {
  live.push(e);
  return e;
};

const expectInvalid = (fn: () => unknown, codeMatcher: RegExp = /INVALID_CONFIG/): void => {
  try {
    fn();
    throw new Error('expected constructor to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(ClarionError);
    expect((err as ClarionError).code).toMatch(codeMatcher);
  }
};

describe('AzureEngine construction validation', () => {
  it('rejects a subscription key shorter than 10 characters', () => {
    expectInvalid(
      () =>
        new AzureEngine({
          auth: { subscriptionKey: 'x', region: 'eastus' },
          recognition: validRecognition,
        }),
    );
  });

  it('rejects a region with uppercase / whitespace (non-slug shape)', () => {
    expectInvalid(
      () =>
        new AzureEngine({
          auth: { subscriptionKey: 'k'.repeat(32), region: 'East US' },
          recognition: validRecognition,
        }),
    );
  });

  it('rejects a language that is not a BCP-47 tag', () => {
    expectInvalid(
      () =>
        new AzureEngine({
          auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
          recognition: { language: 'English' },
        }),
    );
  });

  it('rejects an auth bag with no credentials', () => {
    expectInvalid(
      () =>
        new AzureEngine({
          // @ts-expect-error — intentionally invalid auth shape
          auth: { region: 'eastus' },
          recognition: validRecognition,
        }),
    );
  });

  it('rejects an endpoint string that is not a URL', () => {
    expectInvalid(
      () =>
        new AzureEngine({
          auth: { endpoint: 'not-a-url', subscriptionKey: 'k'.repeat(32) },
          recognition: validRecognition,
        }),
    );
  });

  it('accepts a valid grouped-options shape', () => {
    expect(
      () =>
        track(new AzureEngine({
          auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
          recognition: { language: 'en-US' },
        })),
    ).not.toThrow();
  });

  it('accepts the deprecated flat shape (back-compat)', () => {
    expect(
      () =>
        track(new AzureEngine({
          subscriptionKey: 'k'.repeat(32),
          region: 'eastus',
          language: 'en-US',
        })),
    ).not.toThrow();
  });
});
