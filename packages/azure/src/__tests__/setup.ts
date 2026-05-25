/**
 * Vitest setup: mocks the native bridge + RN modules at module-resolution time
 * so the engine can be exercised in a Node test environment.
 *
 * Individual specs can override the mock factory via `vi.mocked(...)` or by
 * re-mocking inside the test if they need a specific behavior (e.g. simulating
 * a native error or hanging prepare).
 */
import { beforeEach, vi } from 'vitest';
import { __resetPreflightCache } from '../AzureEngine';

beforeEach(() => {
  // Module-level state on the engine module leaks across tests.
  __resetPreflightCache();
});

// ── Native bridge mock ──────────────────────────────────────────────────────
// The default factory returns a fake that succeeds on every call.
// Tests that need different behavior swap individual methods via spy.
let listenerSeq = 0;
const listeners = new Map<number, (...args: unknown[]) => void>();

export const fakeNative = {
  isAvailable: vi.fn(async () => true),
  prepare: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => ({
    id: 'session-1',
    text: '',
    timestamp: Date.now(),
    confidence: 1,
    isFinal: true,
    language: 'en-US',
    segments: [],
    speakerId: '',
    durationMs: 0,
    offsetMs: 0,
  })),
  discard: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  updateAuthToken: vi.fn(async () => undefined),
  addStateListener: vi.fn((cb: (s: string) => void) => {
    const id = ++listenerSeq;
    listeners.set(id, cb as (...args: unknown[]) => void);
    return id;
  }),
  addAudioLevelListener: vi.fn(() => ++listenerSeq),
  addPartialListener: vi.fn(() => ++listenerSeq),
  addFinalListener: vi.fn(() => ++listenerSeq),
  addErrorListener: vi.fn(() => ++listenerSeq),
  addSpeechBoundaryListener: vi.fn(() => ++listenerSeq),
  removeListener: vi.fn((id: number) => {
    listeners.delete(id);
  }),
  removeAllListeners: vi.fn(() => {
    listeners.clear();
  }),
};

/** Fire a fake state event to a registered state listener. */
export const emitState = (state: string): void => {
  const stateCb = fakeNative.addStateListener.mock.calls[0]?.[0];
  if (stateCb) stateCb(state);
};

/** Reset the entire native mock between tests. */
export const resetNativeMock = (): void => {
  listenerSeq = 0;
  listeners.clear();
  Object.values(fakeNative).forEach(fn => {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  });
  // Re-install defaults after reset.
  fakeNative.isAvailable.mockImplementation(async () => true);
  fakeNative.prepare.mockImplementation(async () => undefined);
  fakeNative.start.mockImplementation(async () => undefined);
  fakeNative.stop.mockImplementation(async () => ({
    id: 'session-1', text: '', timestamp: Date.now(), confidence: 1, isFinal: true,
    language: 'en-US', segments: [], speakerId: '', durationMs: 0, offsetMs: 0,
  }));
  fakeNative.discard.mockImplementation(async () => undefined);
  fakeNative.release.mockImplementation(async () => undefined);
  fakeNative.updateAuthToken.mockImplementation(async () => undefined);
  fakeNative.addStateListener.mockImplementation((cb: (s: string) => void) => {
    const id = ++listenerSeq;
    listeners.set(id, cb as (...args: unknown[]) => void);
    return id;
  });
  fakeNative.addAudioLevelListener.mockImplementation(() => ++listenerSeq);
  fakeNative.addPartialListener.mockImplementation(() => ++listenerSeq);
  fakeNative.addFinalListener.mockImplementation(() => ++listenerSeq);
  fakeNative.addErrorListener.mockImplementation(() => ++listenerSeq);
  fakeNative.addSpeechBoundaryListener.mockImplementation(() => ++listenerSeq);
  fakeNative.removeListener.mockImplementation((id: number) => { listeners.delete(id); });
  fakeNative.removeAllListeners.mockImplementation(() => { listeners.clear(); });
};

vi.mock('../native', () => ({
  createNativeAzure: () => fakeNative,
}));

// ── react-native + NetInfo mocks ────────────────────────────────────────────
// AzureEngineObservers does a dynamic `require('react-native').AppState` etc.
// Provide minimal shapes so the observers don't surface the "not available" warning.
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Linking: {
    openSettings: vi.fn(async () => undefined),
  },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn(() => () => undefined) },
}));

// ── Global fetch mock ──────────────────────────────────────────────────────
// preflightAuth() hits the Azure token endpoint. Default to a 200 OK so the
// happy path passes; specs override per case.
globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
