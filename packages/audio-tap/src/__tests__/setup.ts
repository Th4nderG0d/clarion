/**
 * Vitest setup: mocks the native `ClarionAudioTap` HybridObject so the JS
 * surface can be exercised in plain Node. Tests can capture and re-invoke
 * any of the registered listeners via the exported helpers.
 */
import { vi } from 'vitest';
import type {
  NativeAudioTapError,
  NativeAudioTapFrame,
  NativeAudioTapStats,
} from '../specs/ClarionAudioTap.nitro';

let listenerSeq = 0;

interface ListenerRegistry {
  frame: Map<number, (frame: NativeAudioTapFrame) => void>;
  state: Map<number, (state: string) => void>;
  stats: Map<number, (stats: NativeAudioTapStats) => void>;
  error: Map<number, (err: NativeAudioTapError) => void>;
}

export const registry: ListenerRegistry = {
  frame: new Map(),
  state: new Map(),
  stats: new Map(),
  error: new Map(),
};

export const fakeNative = {
  state: 'idle' as string,
  listenerCount: 0 as number,
  start: vi.fn(async (_format: unknown) => undefined),
  stop: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  addFrameListener: vi.fn((cb: (f: NativeAudioTapFrame) => void) => {
    const id = ++listenerSeq;
    registry.frame.set(id, cb);
    return id;
  }),
  addStateListener: vi.fn((cb: (s: string) => void) => {
    const id = ++listenerSeq;
    registry.state.set(id, cb);
    return id;
  }),
  addStatsListener: vi.fn((cb: (s: NativeAudioTapStats) => void) => {
    const id = ++listenerSeq;
    registry.stats.set(id, cb);
    return id;
  }),
  addErrorListener: vi.fn((cb: (e: NativeAudioTapError) => void) => {
    const id = ++listenerSeq;
    registry.error.set(id, cb);
    return id;
  }),
  removeListener: vi.fn((id: number) => {
    registry.frame.delete(id);
    registry.state.delete(id);
    registry.stats.delete(id);
    registry.error.delete(id);
  }),
  removeAllListeners: vi.fn(() => {
    registry.frame.clear();
    registry.state.clear();
    registry.stats.clear();
    registry.error.clear();
  }),
};

vi.mock('../native', () => ({
  createNativeAudioTap: () => fakeNative,
}));

// ── Test helpers ────────────────────────────────────────────────────────────

/** Fire a synthetic PCM frame to every registered frame listener. */
export const emitFrame = (partial?: Partial<NativeAudioTapFrame>): void => {
  const frame: NativeAudioTapFrame = {
    pcm: new ArrayBuffer(1600),
    timestamp: 0,
    frameIndex: 0,
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
    ...partial,
  };
  for (const cb of registry.frame.values()) cb(frame);
};

export const emitState = (state: string): void => {
  for (const cb of registry.state.values()) cb(state);
};

export const emitStats = (partial?: Partial<NativeAudioTapStats>): void => {
  const stats: NativeAudioTapStats = {
    uptimeMs: 1000,
    framesEmitted: 20,
    framesDropped: 0,
    listenerCount: 1,
    bufferFillPct: 0,
    ...partial,
  };
  for (const cb of registry.stats.values()) cb(stats);
};

export const emitError = (partial?: Partial<NativeAudioTapError>): void => {
  const err: NativeAudioTapError = {
    code: 'INTERNAL_ERROR',
    message: 'test error',
    recoverable: false,
    ...partial,
  };
  for (const cb of registry.error.values()) cb(err);
};

/** Reset everything between tests. Call inside beforeEach. */
export const resetNativeMock = (): void => {
  listenerSeq = 0;
  registry.frame.clear();
  registry.state.clear();
  registry.stats.clear();
  registry.error.clear();
  fakeNative.state = 'idle';
  fakeNative.listenerCount = 0;
  for (const fn of Object.values(fakeNative)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  // Re-install defaults.
  fakeNative.start.mockImplementation(async () => undefined);
  fakeNative.stop.mockImplementation(async () => undefined);
  fakeNative.release.mockImplementation(async () => undefined);
  fakeNative.addFrameListener.mockImplementation((cb: (f: NativeAudioTapFrame) => void) => {
    const id = ++listenerSeq;
    registry.frame.set(id, cb);
    return id;
  });
  fakeNative.addStateListener.mockImplementation((cb: (s: string) => void) => {
    const id = ++listenerSeq;
    registry.state.set(id, cb);
    return id;
  });
  fakeNative.addStatsListener.mockImplementation((cb: (s: NativeAudioTapStats) => void) => {
    const id = ++listenerSeq;
    registry.stats.set(id, cb);
    return id;
  });
  fakeNative.addErrorListener.mockImplementation((cb: (e: NativeAudioTapError) => void) => {
    const id = ++listenerSeq;
    registry.error.set(id, cb);
    return id;
  });
  fakeNative.removeListener.mockImplementation((id: number) => {
    registry.frame.delete(id);
    registry.state.delete(id);
    registry.stats.delete(id);
    registry.error.delete(id);
  });
  fakeNative.removeAllListeners.mockImplementation(() => {
    registry.frame.clear();
    registry.state.clear();
    registry.stats.clear();
    registry.error.clear();
  });
};
