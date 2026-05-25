/** Smoke §12: persistFinals + engine.replay(sessionId). */
import { afterEach, describe, expect, it } from 'vitest';
import { AzureEngine } from '../AzureEngine';
import type { ClarionEvent, TranscriptResult } from '@clarionhq/core';
import { resetNativeMock } from './setup';

class InMemoryStorage {
  private map = new Map<string, string>();
  async getItem(k: string): Promise<string | null> { return this.map.get(k) ?? null; }
  async setItem(k: string, v: string): Promise<void> { this.map.set(k, v); }
  async removeItem(k: string): Promise<void> { this.map.delete(k); }
  size(): number { return this.map.size; }
}

let engine: AzureEngine | null = null;
afterEach(async () => {
  await engine?.release();
  engine = null;
  resetNativeMock();
});

describe('persistFinals + replay', () => {
  it('replay() re-emits stored finals as `final` events', async () => {
    const storage = new InMemoryStorage();
    const sessionId = 'test-session-42';
    const stored = [
      { id: 'p1', text: 'hello', timestamp: 1, confidence: 0.95, isFinal: true, language: 'en-US', segments: [] as never[] },
      { id: 'p2', text: 'world', timestamp: 2, confidence: 0.93, isFinal: true, language: 'en-US', segments: [] as never[] },
    ];
    await storage.setItem(
      `clarion-azure-session-${sessionId}`,
      JSON.stringify({ sessionId, finals: stored, writtenAt: Date.now() }),
    );

    engine = new AzureEngine({
      auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
      recognition: { language: 'en-US' },
      advanced: { persistFinals: { storage }, skipAuthPreflight: true },
    });

    const finals: TranscriptResult[] = [];
    engine.on((e: ClarionEvent) => {
      if (e.type === 'final') finals.push(e.result);
    });

    const count = await engine.replay(sessionId);
    expect(count).toBe(2);
    expect(finals.map(f => f.text)).toEqual(['hello', 'world']);
  });

  it('replay() returns 0 for an unknown session id', async () => {
    const storage = new InMemoryStorage();
    engine = new AzureEngine({
      auth: { subscriptionKey: 'k'.repeat(32), region: 'eastus' },
      recognition: { language: 'en-US' },
      advanced: { persistFinals: { storage }, skipAuthPreflight: true },
    });
    const count = await engine.replay('nonexistent');
    expect(count).toBe(0);
  });
});
