import { ClarionError, type ClarionWarning, type ErrorCode } from '@clarionhq/core';

import type { AzureAutoRetryConfig } from './AzureEngineConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Token refresh timer
// ─────────────────────────────────────────────────────────────────────────────

/** Azure auth tokens default to a 10-minute TTL. */
const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
/** How long before expiry to proactively fetch a fresh token. */
const TOKEN_REFRESH_LEAD_MS = 60 * 1000;
/** Min interval between refresh attempts (debounce against flapping providers). */
const MIN_REFRESH_INTERVAL_MS = 5_000;

export interface TokenRefreshCallbacks {
  /** Fetch a fresh token from the user-supplied provider. */
  fetch: () => Promise<string>;
  /** Apply the fresh token to the live engine. */
  apply: (token: string) => Promise<void>;
  /** Emit a non-fatal warning (e.g. "refreshing soon"). */
  warn: (w: ClarionWarning) => void;
  /** Emit a hard error (e.g. provider threw). */
  error: (e: ClarionError) => void;
}

/**
 * Background timer that keeps an Azure auth token fresh.
 *
 * Lifecycle:
 *   1. `start(initialToken, ttlMs)` — schedule refresh at (TTL − lead).
 *   2. On fire: emit `TOKEN_NEAR_EXPIRY` warning, call `fetch()`, call `apply()`,
 *      reschedule.
 *   3. `refreshNow()` — used after a `TOKEN_EXPIRED` mid-session error.
 *   4. `stop()` — cancel any pending timer.
 */
export class TokenRefreshTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private lastRefreshAt = 0;

  constructor(private readonly cb: TokenRefreshCallbacks) {}

  /** Schedule the next refresh `(ttlMs - lead)` from now. Idempotent. */
  start(ttlMs: number = DEFAULT_TOKEN_TTL_MS): void {
    this.stop();
    const refreshIn = Math.max(0, ttlMs - TOKEN_REFRESH_LEAD_MS);
    this.timer = setTimeout(() => {
      this.refreshNow().catch(() => {
        // Errors already surfaced via cb.error — swallow here to avoid unhandledRejection.
      });
    }, refreshIn);
  }

  /** Run a refresh immediately. De-duped if one is already inflight. */
  async refreshNow(): Promise<void> {
    if (this.inflight) return this.inflight;
    const now = Date.now();
    if (now - this.lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;
    this.lastRefreshAt = now;

    this.cb.warn({
      code: 'TOKEN_NEAR_EXPIRY',
      message: 'Azure auth token nearing expiry — fetching a fresh one.',
    });

    this.inflight = (async () => {
      try {
        const token = await this.cb.fetch();
        if (!token || token.trim().length === 0) {
          throw new ClarionError({
            code: 'AUTH_FAILED',
            message: 'tokenProvider returned an empty token.',
            where: 'mid-session',
          });
        }
        await this.cb.apply(token);
        // Reschedule next refresh assuming default TTL — caller may override
        // by supplying a tokenTtlMs in the next start() call.
        this.start();
      } catch (err) {
        this.cb.error(
          err instanceof ClarionError
            ? err
            : new ClarionError({
                code: 'AUTH_FAILED',
                message: `tokenProvider threw: ${err instanceof Error ? err.message : String(err)}`,
                where: 'mid-session',
                cause: err,
              }),
        );
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-retry helper
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RETRY_CODES: ReadonlyArray<ErrorCode> = [
  'NETWORK_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'NETWORK_DROPPED',
  'DNS_FAILURE',
  'SERVICE_DOWN',
  'AUDIO_BUSY',
];

export interface RetryEmissions {
  /** Emit a warning for each retry attempt (so devs can show "retrying…" UI). */
  warn: (w: ClarionWarning) => void;
}

/**
 * Run `fn`. If it throws a `ClarionError` whose code is in `retryOn`, retry
 * with exponential backoff up to `maxAttempts` additional times.
 *
 * Each retry emits a `RETRY_ATTEMPTED` warning with `attempt` and `maxAttempts`
 * in `details` so a UI can show a "retrying…" indicator.
 *
 * If the final attempt still fails, the original error is re-thrown.
 */
export const withAutoRetry = async <T>(
  fn: () => Promise<T>,
  config: AzureAutoRetryConfig | undefined,
  emissions: RetryEmissions,
  context: string,
): Promise<T> => {
  const maxAttempts = config?.maxAttempts ?? 0;
  const baseDelayMs = config?.baseDelayMs ?? 500;
  const retryOn = config?.retryOn ?? DEFAULT_RETRY_CODES;

  if (maxAttempts <= 0) {
    return fn();
  }

  let attempt = 0;
  // first call + `maxAttempts` additional retries
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const ce = err instanceof ClarionError ? err : null;
      const code = ce?.code;
      const shouldRetry = code !== undefined && retryOn.includes(code) && attempt < maxAttempts;
      if (!shouldRetry) throw err;

      attempt += 1;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      emissions.warn({
        code: 'RETRY_ATTEMPTED',
        message: `Retrying ${context} after ${code} (attempt ${attempt}/${maxAttempts}, backoff ${delay}ms).`,
        details: {
          attempt,
          maxAttempts,
          backoffMs: delay,
          triggerCode: code,
          context,
        },
      });
      await sleep(delay);
    }
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
