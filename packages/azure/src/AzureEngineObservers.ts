/**
 * AppState + NetInfo observers for AzureEngine. Best-effort — missing native
 * modules degrade to a no-op + warning so we don't crash outside RN.
 */

import {
  ClarionError,
  type ClarionWarning,
} from '@clarionhq/core';

interface AppStateLike {
  currentState: string;
  addEventListener: (
    type: string,
    handler: (state: string) => void,
  ) => { remove: () => void } | (() => void);
}

const APP_STATE: AppStateLike | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native');
    const appState = rn?.AppState as Partial<AppStateLike> | undefined;
    if (!appState || typeof appState.addEventListener !== 'function') return null;
    return appState as AppStateLike;
  } catch {
    return null;
  }
})();

export interface AppStateObserverCallbacks {
  /** Fired when app moves to background ('background' or 'inactive'). */
  onBackground: () => void;
  /** Fired when app returns to foreground ('active'). */
  onForeground: () => void;
  warn: (w: ClarionWarning) => void;
}

/**
 * Observes RN's AppState. Useful to auto-stop sessions when the user
 * backgrounds the app (the audio session deactivates anyway; better to fail
 * loudly than to keep accumulating finals that will never arrive).
 */
export class AppStateObserver {
  private subscription: { remove: () => void } | (() => void) | null = null;
  private appState: AppStateLike | null = null;

  constructor(private readonly cb: AppStateObserverCallbacks) {}

  start(): void {
    this.appState = APP_STATE;
    if (!this.appState) {
      this.cb.warn({
        code: 'UNKNOWN',
        message: 'AppState not available (running outside React Native?). Backgrounding handler disabled.',
      });
      return;
    }
    this.subscription = this.appState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        this.cb.onBackground();
      } else if (state === 'active') {
        this.cb.onForeground();
      }
    });
  }

  stop(): void {
    if (!this.subscription) return;
    if (typeof this.subscription === 'function') {
      this.subscription();
    } else {
      this.subscription.remove();
    }
    this.subscription = null;
  }
}


/**
 * Shape of @react-native-community/netinfo subscriber state. We type
 * minimally so we don't need the package as a dep.
 */
interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string;
}

interface NetInfoModule {
  addEventListener: (handler: (state: NetInfoState) => void) => () => void;
}

// Some bundlers return an empty stub object instead of throwing when the
// package isn't installed — validate the shape before claiming it's usable.
const NET_INFO: NetInfoModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo');
    const resolved = (mod?.default ?? mod) as Partial<NetInfoModule> | undefined;
    if (!resolved || typeof resolved.addEventListener !== 'function') return null;
    return resolved as NetInfoModule;
  } catch {
    return null;
  }
})();

export interface NetworkObserverCallbacks {
  /**
   * Fired when connectivity is confirmed gone for at least
   * `gracePeriodMs` — gives flaky networks a chance to recover before we
   * surface a hard error.
   */
  onDrop: (error: ClarionError) => void;
  /** Fired when connectivity returns. */
  onReconnect: () => void;
  /** Fired for brief blips that recovered within the grace period. */
  warn: (w: ClarionWarning) => void;
}

export interface NetworkObserverOptions {
  /** Wait this long before classifying a drop as a real error. Default: 2000 ms. */
  gracePeriodMs?: number;
}

/**
 * Observes network connectivity via the optional `@react-native-community/netinfo`
 * package. If NetInfo isn't installed, the observer is a no-op (and emits a
 * warning at start so devs know).
 */
export class NetworkObserver {
  private unsub: (() => void) | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private wasConnected = true;

  constructor(
    private readonly cb: NetworkObserverCallbacks,
    private readonly options: NetworkObserverOptions = {},
  ) {}

  start(): void {
    const mod = NET_INFO;
    if (!mod) {
      this.cb.warn({
        code: 'UNKNOWN',
        message:
          '@react-native-community/netinfo not installed — network monitoring disabled. ' +
          'Run `pnpm add @react-native-community/netinfo` if you want mid-session drop detection.',
      });
      return;
    }
    const grace = this.options.gracePeriodMs ?? 2000;
    this.unsub = mod.addEventListener((state) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      if (connected) {
        if (!this.wasConnected) {
          this.wasConnected = true;
          this.cancelGrace();
          this.cb.onReconnect();
        }
        return;
      }
      // Drop detected — start grace timer if not already running.
      if (this.wasConnected) {
        this.wasConnected = false;
        this.cb.warn({
          code: 'UNKNOWN',
          message: `Network blip detected (type=${state.type ?? 'unknown'}) — will retry for ${grace} ms.`,
        });
        this.graceTimer = setTimeout(() => {
          this.cb.onDrop(
            new ClarionError({
              code: 'NETWORK_DROPPED',
              message: `Network connectivity lost for >${grace} ms (type=${state.type ?? 'unknown'}).`,
              where: 'mid-session',
              recoverable: true,
              details: { networkType: state.type ?? 'unknown' },
            }),
          );
        }, grace);
      }
    });
  }

  stop(): void {
    this.cancelGrace();
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private cancelGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}
