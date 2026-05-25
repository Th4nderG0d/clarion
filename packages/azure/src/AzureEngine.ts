import {
  ClarionEmitter,
  ClarionError,
  assertTransition,
  fromNativeError,
  validateAzureAuthMode,
  validateLanguage,
  type ClarionEngine,
  type ClarionEvent,
  type ClarionWarning,
  type EngineKind,
  type EngineState,
  type ErrorCode,
  type Listener,
  type TranscriptResult,
  type TranscriptSegment,
  type Unsubscribe,
} from '@clarionhq/core';

import {
  isTokenProviderAuth,
  normalizeAzureEngineOptions,
  resolveCredentials,
  type AzureAuth,
  type AzureEngineOptions,
  type AzureTelemetry,
  type FlatAzureEngineOptions,
  type ResolvedAzureCredentials,
} from './AzureEngineConfig';
import { AppStateObserver, NetworkObserver } from './AzureEngineObservers';
import { TokenRefreshTimer, withAutoRetry } from './AzureEngineSupport';
import { createNativeAzure } from './native';
import type {
  ClarionAzure,
  NativeAzureConfig,
  NativeAzureError,
  NativeTranscriptResult,
  NativeTranscriptSegment,
} from './specs/ClarionAzure.nitro';

export type {
  AzureAuth,
  AzureEngineOptions,
  AzureRecognition,
  AzureAdvanced,
  AzureAutoRetryConfig,
  AzureTelemetry,
  AzureOutputFormat,
  AzureProfanityFilter,
  FlatAzureEngineOptions,
} from './AzureEngineConfig';

const VALID_STATES: readonly EngineState[] = [
  'idle',
  'preparing',
  'ready',
  'starting',
  'recording',
  'paused',
  'stopping',
  'error',
  'released',
];

const isEngineState = (s: string): s is EngineState =>
  (VALID_STATES as readonly string[]).includes(s);

const DEFAULT_AUDIO_LEVEL_INTERVAL_MS = 50;
const DEFAULT_OUTPUT_FORMAT = 'detailed' as const;
const DEFAULT_PROFANITY = 'masked' as const;
const DEFAULT_PREPARE_TIMEOUT_MS = 15_000;
/** Pre-flight validation results are cached this long to skip repeat fetches. */
const PREFLIGHT_CACHE_TTL_MS = 5 * 60_000;
/** Cache of successful `(key, region)` validations across all engine instances. */
const preflightCache = new Map<string, number>();

/** @internal — test helper to clear the pre-flight cache between specs. */
export const __resetPreflightCache = (): void => {
  preflightCache.clear();
};

const preflightError = (
  code: ErrorCode,
  message: string,
  userMessage: string,
  extras: { recoverable?: boolean; retryAfterMs?: number } = {},
): ClarionError =>
  new ClarionError({
    code,
    message,
    userMessage,
    where: 'prepare',
    recoverable: extras.recoverable ?? false,
    ...(extras.retryAfterMs !== undefined ? { retryAfterMs: extras.retryAfterMs } : {}),
  });

const mapPreflightStatus = (status: number, region: string): ClarionError => {
  if (status === 401 || status === 403) {
    return preflightError(
      'AUTH_FAILED',
      `Azure rejected the subscription key (${status}). Verify the key is correct, active, and matches region "${region}".`,
      'Authentication failed. Please check your subscription key.',
    );
  }
  if (status === 404) {
    return preflightError(
      'INVALID_CONFIG',
      `Region "${region}" was not found (404). Check the region slug — common values: eastus, westeurope, centralindia.`,
      'Unknown Azure region. Please check the region name.',
    );
  }
  if (status === 429) {
    return preflightError(
      'QUOTA_EXCEEDED',
      'Azure token endpoint returned 429 (rate limit / quota). Your tier may be exhausted.',
      'Service quota exceeded. Please try again later.',
      { recoverable: true, retryAfterMs: 30_000 },
    );
  }
  if (status >= 500) {
    return preflightError(
      'SERVICE_DOWN',
      `Azure token endpoint returned ${status}. The service may be degraded — retry shortly.`,
      'Service is temporarily unavailable. Please try again in a moment.',
      { recoverable: true },
    );
  }
  return preflightError(
    'INTERNAL_ERROR',
    `Azure token endpoint returned unexpected status ${status} during auth pre-flight.`,
    'Authentication failed. Please try again.',
  );
};
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Tracks live AzureEngine instances for the singleton check. */
const liveInstances = new Set<object>();

/**
 * Probe whether the Azure Speech SDK is reachable with the supplied credentials.
 * Best-effort: returns true on a successful 1-token auth handshake, false otherwise.
 * Use before `start()` to fail fast on bad keys / wrong region.
 *
 * Accepts the grouped options (preferred) OR the flat 0.1.x shape (deprecated).
 */
export const isAzureAvailable = async (
  options: AzureEngineOptions | FlatAzureEngineOptions,
): Promise<boolean> => {
  const normalized = normalizeAzureEngineOptions(options);
  const creds = resolveCredentials(normalized.auth, null);
  return createNativeAzure().isAvailable(buildNativeAzureConfig(normalized, creds));
};

/**
 * Microsoft Cognitive Services Speech SDK wrapped behind `ClarionEngine`.
 * Final transcript surfaces via the `'final'` event, not the `stop()` promise.
 */
export class AzureEngine implements ClarionEngine {
  readonly kind: EngineKind = 'azure-recognizer';

  /** See top-level `isAzureAvailable`. */
  static isAvailable = isAzureAvailable;

  private readonly emitter = new ClarionEmitter();
  private readonly native: ClarionAzure;
  private readonly listenerIds: number[] = [];

  /** Canonical options after normalization (and any tokenProvider results applied). */
  private opts: AzureEngineOptions;
  /** Most recent token from a `tokenProvider`, if any. */
  private currentToken: string | null = null;
  /** Token-refresh background timer. Null when auth mode isn't `tokenProvider`. */
  private tokenTimer: TokenRefreshTimer | null = null;
  /** AppState observer for backgrounding. Null when `autoStopOnBackground: false`. */
  private appStateObserver: AppStateObserver | null = null;
  /** NetInfo observer for mid-session drops. Always created; no-ops if NetInfo isn't installed. */
  private networkObserver: NetworkObserver | null = null;

  /** Telemetry state for the current session. Reset on each `start()`. */
  private sessionId: string | null = null;
  private sessionStartMs = 0;
  private sessionPhraseCount = 0;
  private sessionHadError = false;
  /** Heartbeat for `onUsageUpdate`. */
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-session accumulated finals (for persistFinals + replay). */
  private accumulatedFinals: TranscriptResult[] = [];
  /** Held-onto session id for `replay()` even after a session ends. */
  private lastSessionId: string | null = null;

  private currentState: EngineState = 'idle';

  constructor(rawOptions: AzureEngineOptions | FlatAzureEngineOptions) {
    // Accept both the new grouped shape and the legacy flat 0.1.x shape.
    // normalizeAzureEngineOptions emits a one-shot console.warn for flat input.
    const opts = normalizeAzureEngineOptions(rawOptions);

    // Pre-flight: catch config bugs before any native work.
    validateLanguage(opts.recognition.language);
    const creds = resolveCredentials(opts.auth, null);
    const authInput: Parameters<typeof validateAzureAuthMode>[0] = {};
    if (creds.subscriptionKey) authInput.subscriptionKey = creds.subscriptionKey;
    if (creds.region) authInput.region = creds.region;
    if (creds.authToken) authInput.authToken = creds.authToken;
    if (creds.endpoint) authInput.endpoint = creds.endpoint;
    // tokenProvider mode validates as token-OR-endpoint at runtime — accept
    // empty token here so the constructor doesn't reject before the first
    // tokenProvider() call lands.
    if (isTokenProviderAuth(opts.auth)) {
      authInput.authToken = authInput.authToken || 'pending';
    }
    validateAzureAuthMode(authInput);

    // Singleton enforcement: two parallel sessions fight over the mic + audio
    // session category and produce hard-to-diagnose bugs. Opt-out via
    // `advanced.allowMultipleInstances` for the rare app that wants this.
    if (
      liveInstances.size > 0 &&
      opts.advanced?.allowMultipleInstances !== true
    ) {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message:
          'Another AzureEngine instance is already alive. Call `release()` on it first, ' +
          'or set `advanced.allowMultipleInstances: true` if you really need parallel sessions.',
        where: 'config-validation',
      });
    }
    liveInstances.add(this);

    this.opts = opts;
    this.native = createNativeAzure();
    this.bindNativeListeners();

    // Set up the token-refresh timer if the caller uses tokenProvider auth.
    if (isTokenProviderAuth(opts.auth)) {
      const tokenAuth = opts.auth;
      this.tokenTimer = new TokenRefreshTimer({
        fetch: () => tokenAuth.tokenProvider(),
        apply: (token) => this.applyRefreshedToken(token),
        warn: (w) => this.emitWarning(w),
        error: (e) => this.emitError(e),
      });
    }
  }


  get state(): EngineState {
    return this.currentState;
  }

  /** Readonly view of the canonical options as the engine sees them. */
  get options(): Readonly<AzureEngineOptions> {
    // Defensive shallow clone so callers can't mutate our internal state.
    return {
      auth: { ...this.opts.auth } as AzureAuth,
      recognition: { ...this.opts.recognition },
      ...(this.opts.advanced ? { advanced: { ...this.opts.advanced } } : {}),
      ...(this.opts.telemetry ? { telemetry: { ...this.opts.telemetry } } : {}),
    };
  }

  on(listener: Listener<ClarionEvent>): Unsubscribe {
    return this.emitter.on(listener);
  }

  async prepare(): Promise<void> {
    return withAutoRetry(
      () => this.prepareOnce(),
      this.opts.advanced?.autoRetry,
      { warn: (w) => this.emitWarning(w) },
      'prepare',
    );
  }

  async start(): Promise<void> {
    return withAutoRetry(
      () => this.startOnce(),
      this.opts.advanced?.autoRetry,
      { warn: (w) => this.emitWarning(w) },
      'start',
    );
  }

  pause(): Promise<void> {
    return Promise.reject(
      new ClarionError({
        code: 'INVALID_STATE',
        message:
          'AzureEngine.pause() is not supported. Azure speech-to-text bills per connection and ' +
          'mid-stream pause would silently drop audio. Call `stop()` to end the session ' +
          '(emits a final transcript), then `start()` to begin a new one. The session-final ' +
          'from stop() and the next start() share no state, so you may need to concatenate ' +
          'them in your UI.',
        userMessage: 'Pause isn\'t supported. Tap Stop to end the recording, then Start to record more.',
        where: 'unknown',
        details: {
          recommendation: 'Call stop() then start() instead.',
        },
      }),
    );
  }

  resume(): Promise<void> {
    return Promise.reject(
      new ClarionError({
        code: 'INVALID_STATE',
        message: 'AzureEngine.resume() is not supported. See pause() for the recommended pattern.',
        userMessage: 'Resume isn\'t supported. Tap Start to begin a new recording.',
        where: 'unknown',
        details: { recommendation: 'Call start() to begin a fresh session.' },
      }),
    );
  }

  async stop(): Promise<void> {
    this.transitionTo('stopping');
    try {
      const result = await this.native.stop();
      this.emitFinal(this.toTranscriptResult(result));
      this.fireSessionEnd('stop');
    } catch (err) {
      this.handleNativeError(err, 'stop');
      throw err;
    } finally {
      this.stopEnvironmentObservers();
    }
  }

  async discard(): Promise<void> {
    try {
      await this.native.discard();
      this.fireSessionEnd('discard');
    } catch (err) {
      this.handleNativeError(err, 'discard');
      throw err;
    } finally {
      this.stopEnvironmentObservers();
    }
  }

  async release(): Promise<void> {
    if (this.currentState === 'released') return;
    this.stopEnvironmentObservers();
    this.stopUsageHeartbeat();
    this.tokenTimer?.stop();
    this.tokenTimer = null;
    try {
      this.native.removeAllListeners();
      await this.native.release();
    } catch {
      // release() must never throw — teardown errors aren't actionable.
    } finally {
      this.fireSessionEnd('release');
      this.listenerIds.length = 0;
      this.emitter.removeAll();
      this.currentState = 'released';
      liveInstances.delete(this);
    }
  }

  /**
   * Replace the current Azure auth token (e.g. when refreshing a short-lived
   * STS token before it expires). Safe to call at any state — the change
   * takes effect on the next websocket reconnect / `start()`.
   *
   * For `tokenProvider`-based auth, prefer letting the engine refresh
   * automatically via the timer instead of calling this manually.
   */
  async updateAuthToken(token: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new ClarionError({
        code: 'INVALID_CONFIG',
        message: 'updateAuthToken: token must be non-empty',
        where: 'config-validation',
      });
    }
    this.currentToken = token;
    await this.native.updateAuthToken(token);
  }


  private async prepareOnce(): Promise<void> {
    this.assertClockNotSkewed();
    // A previous attempt may have left the state machine at 'error'; reset
    // so auto-retry can transition cleanly back into 'preparing'.
    if (this.currentState === 'error') this.setState('idle');
    this.transitionTo('preparing');
    try {
      // tokenProvider mode: fetch the initial token (and start the refresh timer).
      if (isTokenProviderAuth(this.opts.auth) && !this.currentToken) {
        await this.tokenTimer!.refreshNow();
        this.tokenTimer!.start(this.opts.auth.tokenTtlMs);
      }
      // Catch bad key / wrong region before opening the audio session.
      await this.preflightAuth();
      await this.withPrepareTimeout(this.native.prepare(this.buildCurrentNativeConfig()));
    } catch (err) {
      this.handleNativeError(err, 'prepare');
      throw err;
    }
  }

  /**
   * Validate `(subscriptionKey, region)` via Azure's STS endpoint. Only runs
   * for subscriptionKey auth — other modes validate via their own paths.
   */
  private async preflightAuth(): Promise<void> {
    if (this.opts.advanced?.skipAuthPreflight) return;
    const auth = this.opts.auth;
    if (!('subscriptionKey' in auth) || !auth.subscriptionKey) return;
    if (!('region' in auth) || !auth.region) return;

    // Skip the network round-trip if we validated this (key, region) recently.
    const cacheKey = `${auth.region}|${auth.subscriptionKey}`;
    const cachedAt = preflightCache.get(cacheKey);
    if (cachedAt && Date.now() - cachedAt < PREFLIGHT_CACHE_TTL_MS) return;

    // Bound the fetch by the same prepare budget so a blocked network surfaces
    // as a clean NETWORK_TIMEOUT instead of hanging the engine indefinitely.
    const timeoutMs = this.opts.advanced?.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let resp: Response;
    try {
      resp = await fetch(
        `https://${auth.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
        {
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': auth.subscriptionKey },
          signal: controller.signal,
        },
      );
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw preflightError(
        aborted ? 'NETWORK_TIMEOUT' : 'NETWORK_UNAVAILABLE',
        aborted
          ? `Pre-flight auth check timed out after ${timeoutMs} ms.`
          : `Cannot reach Azure to validate credentials: ${err instanceof Error ? err.message : String(err)}`,
        aborted
          ? 'Network is slow. Please try again.'
          : 'No internet connection. Please check your network and try again.',
        { recoverable: true },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (resp.status === 200) {
      preflightCache.set(cacheKey, Date.now());
      return;
    }
    throw mapPreflightStatus(resp.status, auth.region);
  }

  /**
   * Race the native prepare against the configured timeout. Without this the
   * SDK can sit forever on a slow / blocked / proxied network and never
   * surface a real error.
   */
  private withPrepareTimeout<T>(native: Promise<T>): Promise<T> {
    const ms = this.opts.advanced?.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    if (ms <= 0) return native;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ClarionError({
            code: 'NETWORK_TIMEOUT',
            message: `prepare() timed out after ${ms} ms. Check network connectivity to Azure.`,
            where: 'prepare',
            recoverable: true,
          }),
        );
      }, ms);
      native.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /**
   * Azure auth tokens are time-signed; surface a clean INVALID_CONFIG when
   * the device clock is grossly wrong instead of a cryptic AUTH_FAILED later.
   */
  private assertClockNotSkewed(): void {
    const tolerance = this.opts.advanced?.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
    if (tolerance <= 0) return;
    const now = Date.now();
    // Reasonable sanity window. Picked conservatively — Azure existed in 2024,
    // not going to exist in 2100.
    const lowerBoundMs = Date.UTC(2024, 0, 1);
    const upperBoundMs = Date.UTC(2100, 0, 1);
    if (now < lowerBoundMs || now > upperBoundMs) {
      const iso = new Date(now).toISOString();
      throw new ClarionError({
        code: 'INVALID_CONFIG',
        message: `Device clock looks wrong (${iso}). Azure auth tokens are time-sensitive — please correct the device time.`,
        userMessage: 'Your device clock looks wrong. Please correct the date and time in Settings.',
        where: 'prepare',
        openSettings: true,
        details: { deviceClock: iso },
      });
    }
  }

  private async startOnce(): Promise<void> {
    if (this.currentState === 'error') this.setState('idle');
    if (this.currentState === 'idle') await this.prepareOnce();
    if (this.currentState !== 'ready') {
      throw new ClarionError({
        code: 'INVALID_STATE',
        message: `Cannot start from state '${this.currentState}'`,
        where: 'start',
      });
    }
    this.transitionTo('starting');
    try {
      await this.native.start();
      this.fireSessionStart();
      this.startEnvironmentObservers();
    } catch (err) {
      this.handleNativeError(err, 'start');
      throw err;
    }
  }

  /**
   * Install AppState + NetInfo observers for the current session; both
   * auto-tear-down via stop/discard/release.
   */
  private startEnvironmentObservers(): void {
    if (this.opts.advanced?.autoStopOnBackground !== false) {
      this.appStateObserver = new AppStateObserver({
        onBackground: () => {
          this.emitWarning({
            code: 'BACKGROUNDED',
            message: 'App moved to background — stopping the session.',
          });
          // Best-effort stop; don't throw if it races with user-driven stop.
          this.stop().catch(() => { /* already surfaced */ });
        },
        onForeground: () => { /* deliberately no auto-resume */ },
        warn: (w) => this.emitWarning(w),
      });
      this.appStateObserver.start();
    }
    this.networkObserver = new NetworkObserver({
      onDrop: (error) => this.emitError(error),
      onReconnect: () => {
        this.emitWarning({
          code: 'UNKNOWN',
          message: 'Network reconnected.',
        });
      },
      warn: (w) => this.emitWarning(w),
    });
    this.networkObserver.start();
  }

  private stopEnvironmentObservers(): void {
    this.appStateObserver?.stop();
    this.appStateObserver = null;
    this.networkObserver?.stop();
    this.networkObserver = null;
  }

  private async applyRefreshedToken(token: string): Promise<void> {
    this.currentToken = token;
    // Best-effort: native exposes updateAuthToken which writes to the live
    // recognizer's property bag. The change takes effect on the next reconnect.
    try {
      await this.native.updateAuthToken(token);
    } catch (err) {
      // Don't surface as a hard error — the token is still good for the next
      // prepare() / start(). Emit a warning so analytics catches it.
      this.emitWarning({
        code: 'UNKNOWN',
        message: `updateAuthToken native call failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }


  private buildCurrentNativeConfig(): NativeAzureConfig {
    const creds = resolveCredentials(this.opts.auth, this.currentToken);
    return buildNativeAzureConfig(this.opts, creds);
  }

  private bindNativeListeners(): void {
    this.listenerIds.push(
      this.native.addStateListener((nativeState) => {
        if (!isEngineState(nativeState)) return;
        this.setState(nativeState);
      }),
    );

    this.listenerIds.push(
      this.native.addAudioLevelListener((rms, peak) => {
        this.emitter.emit({ type: 'audio-level', rms, peak });
      }),
    );

    this.listenerIds.push(
      this.native.addPartialListener((result) => {
        this.emitPartialDebounced(this.toTranscriptResult(result));
      }),
    );

    this.listenerIds.push(
      this.native.addFinalListener((result) => {
        this.sessionPhraseCount += 1;
        const tx = this.toTranscriptResult(result);
        this.accumulatedFinals.push(tx);
        // Flush any pending partial so the final always lands cleanly after it.
        this.flushPendingPartial();
        this.emitter.emit({ type: 'final', result: tx });
        this.maybeEmitLowConfidence(tx);
        // Fire-and-forget persistence (errors swallowed inside).
        this.persistFinalsAsync();
      }),
    );

    this.listenerIds.push(
      this.native.addErrorListener((err) => {
        this.emitError(this.toClarionError(err));
      }),
    );

    this.listenerIds.push(
      this.native.addSpeechBoundaryListener((kind, offsetMs) => {
        if (kind === 'started') {
          this.emitter.emit({ type: 'speech-started', offsetMs });
        } else if (kind === 'ended') {
          this.emitter.emit({ type: 'speech-ended', offsetMs });
        }
      }),
    );
  }


  /** Latest pending partial waiting to be emitted (debounce buffer). */
  private pendingPartial: TranscriptResult | null = null;
  /** Timer for the debounce — fires the latest pending partial. */
  private partialTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Emit a partial result, optionally debounced. Azure's `Recognizing` events
   * can fire 5-10×/sec; without throttling the UI re-renders constantly and
   * text flickers. Default debounce is 100 ms — feels real-time but renders
   * at a sane rate.
   */
  private emitPartialDebounced(result: TranscriptResult): void {
    const ms = this.opts.recognition.partialDebounceMs ?? 100;
    if (ms <= 0) {
      this.emitter.emit({ type: 'partial', result });
      return;
    }
    this.pendingPartial = result;
    if (this.partialTimer !== null) return;
    this.partialTimer = setTimeout(() => {
      this.flushPendingPartial();
    }, ms);
  }

  private flushPendingPartial(): void {
    if (this.partialTimer !== null) {
      clearTimeout(this.partialTimer);
      this.partialTimer = null;
    }
    if (this.pendingPartial) {
      this.emitter.emit({ type: 'partial', result: this.pendingPartial });
      this.pendingPartial = null;
    }
  }

  /**
   * Emit `'audio-confidence'` when a final's aggregate confidence falls below
   * the user-configured threshold. Lets UIs show "audio looks unclear" hints
   * without devs having to inspect every transcript.
   */
  private maybeEmitLowConfidence(result: TranscriptResult): void {
    const threshold = this.opts.recognition.lowConfidenceThreshold ?? 0;
    if (threshold <= 0) return;
    if (result.confidence === undefined) return;
    if (result.confidence >= threshold) return;
    this.emitter.emit({ type: 'audio-confidence', confidence: result.confidence, result });
  }

  private transitionTo(next: EngineState): void {
    if (this.currentState === next) return;
    assertTransition(this.currentState, next);
    this.setState(next);
  }

  private setState(next: EngineState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.emitter.emit({ type: 'state', state: next });
  }


  private emitFinal(result: TranscriptResult): void {
    this.sessionPhraseCount += 1;
    this.emitter.emit({ type: 'final', result });
  }

  private emitError(error: ClarionError): void {
    this.sessionHadError = true;
    this.emitter.emit({ type: 'error', error });
    this.invokeTelemetry((t) => t.onError?.(error));
    // If the error is a TOKEN_EXPIRED and we have a provider, opportunistically refresh.
    if (error.code === 'TOKEN_EXPIRED' && this.tokenTimer) {
      this.tokenTimer.refreshNow().catch(() => { /* surfaced via cb.error */ });
    }
  }

  private emitWarning(warning: ClarionWarning): void {
    this.emitter.emit({ type: 'warning', warning });
    this.invokeTelemetry((t) => t.onWarning?.(warning));
  }

  private fireSessionStart(): void {
    this.sessionId = generateSessionId();
    this.lastSessionId = this.sessionId;
    this.sessionStartMs = Date.now();
    this.sessionPhraseCount = 0;
    this.sessionHadError = false;
    this.accumulatedFinals = [];
    this.invokeTelemetry((t) =>
      t.onSessionStart?.({
        sessionId: this.sessionId!,
        language: this.opts.recognition.language,
      }),
    );
    this.startUsageHeartbeat();
  }

  private fireSessionEnd(reason: 'stop' | 'discard' | 'error' | 'release'): void {
    if (this.sessionId === null) return;
    const summary = {
      sessionId: this.sessionId,
      phraseCount: this.sessionPhraseCount,
      durationMs: Math.max(0, Date.now() - this.sessionStartMs),
      hadError: this.sessionHadError,
      reason,
    };
    this.invokeTelemetry((t) => t.onSessionEnd?.(summary));
    this.sessionId = null;
    this.stopUsageHeartbeat();
    // On graceful stop, clear persisted state (the session is "done"). On
    // discard/error/release we leave it so the next launch can replay it.
    if (reason === 'stop') {
      this.clearPersistedFinalsAsync();
    }
  }


  private startUsageHeartbeat(): void {
    if (!this.opts.telemetry?.onUsageUpdate) return;
    this.stopUsageHeartbeat();
    this.usageTimer = setInterval(() => {
      const id = this.sessionId;
      if (id === null) return;
      this.invokeTelemetry((t) =>
        t.onUsageUpdate?.({
          sessionId: id,
          elapsedMs: Math.max(0, Date.now() - this.sessionStartMs),
        }),
      );
    }, 30_000);
  }

  private stopUsageHeartbeat(): void {
    if (this.usageTimer) {
      clearInterval(this.usageTimer);
      this.usageTimer = null;
    }
  }


  /** Write the current accumulator to storage. Fire-and-forget; errors emit a warning. */
  private persistFinalsAsync(): void {
    const cfg = this.opts.advanced?.persistFinals;
    if (!cfg || this.sessionId === null) return;
    const key = this.persistKey(this.sessionId, cfg.keyPrefix);
    const payload = JSON.stringify({
      sessionId: this.sessionId,
      finals: this.accumulatedFinals,
      writtenAt: Date.now(),
    });
    cfg.storage.setItem(key, payload).catch((err) => {
      this.emitWarning({
        code: 'UNKNOWN',
        message: `persistFinals.setItem failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }

  private clearPersistedFinalsAsync(): void {
    const cfg = this.opts.advanced?.persistFinals;
    if (!cfg || this.lastSessionId === null) return;
    cfg.storage.removeItem(this.persistKey(this.lastSessionId, cfg.keyPrefix)).catch(() => {
      // Quiet — cleanup failure shouldn't surface; the next session will overwrite anyway.
    });
  }

  private persistKey(sessionId: string, prefix: string | undefined): string {
    return `${prefix ?? 'clarion-azure-session-'}${sessionId}`;
  }

  /**
   * Re-emit a persisted session's finals as `'final'` events. Returns the
   * count replayed (0 if nothing persisted under that sessionId).
   */
  async replay(sessionId: string): Promise<number> {
    const cfg = this.opts.advanced?.persistFinals;
    if (!cfg) return 0;
    const raw = await cfg.storage.getItem(this.persistKey(sessionId, cfg.keyPrefix));
    if (!raw) return 0;
    try {
      const payload = JSON.parse(raw) as { finals?: TranscriptResult[] };
      const finals = payload.finals ?? [];
      for (const final of finals) {
        this.emitter.emit({ type: 'final', result: final });
      }
      return finals.length;
    } catch (err) {
      this.emitWarning({
        code: 'UNKNOWN',
        message: `replay: persisted payload was malformed (${err instanceof Error ? err.message : String(err)}).`,
      });
      return 0;
    }
  }

  private invokeTelemetry(call: (t: AzureTelemetry) => void): void {
    const t = this.opts.telemetry;
    if (!t) return;
    try {
      call(t);
    } catch {
      // Telemetry callbacks must never destabilize the engine.
    }
  }


  private toTranscriptResult(r: NativeTranscriptResult): TranscriptResult {
    const result: TranscriptResult = {
      id: r.id,
      sessionId: r.sessionId,
      timestamp: r.timestamp,
      text: r.text,
      isFinal: r.isFinal,
    };
    if (r.language && r.language.length > 0) result.language = r.language;
    if (r.confidence >= 0) result.confidence = r.confidence;
    if (r.offsetMs >= 0) result.offsetMs = r.offsetMs;
    if (r.durationMs >= 0) result.durationMs = r.durationMs;
    if (r.speakerId && r.speakerId.length > 0) result.speakerId = r.speakerId;
    if (r.segments && r.segments.length > 0) {
      result.segments = r.segments.map((s) => this.toTranscriptSegment(s));
    }
    return result;
  }

  private toTranscriptSegment(s: NativeTranscriptSegment): TranscriptSegment {
    const seg: TranscriptSegment = {
      text: s.text,
      startMs: s.startMs,
      durationMs: s.durationMs,
    };
    if (s.confidence >= 0) seg.confidence = s.confidence;
    if (s.alternatives && s.alternatives.length > 0) {
      seg.alternatives = s.alternatives;
    }
    return seg;
  }

  private toClarionError(err: NativeAzureError): ClarionError {
    return new ClarionError({
      code: mapNativeCodeToClarion(err.code),
      message: err.message,
      recoverable: err.recoverable,
      where: 'mid-session',
    });
  }

  private handleNativeError(err: unknown, where: 'prepare' | 'start' | 'stop' | 'discard'): void {
    const error = fromNativeError(err, `Azure ${where} failed`, where);
    this.emitError(error);
    this.setState('error');
  }
}


const KNOWN_NATIVE_CODES: ReadonlyArray<ErrorCode> = [
  'PERMISSION_DENIED',
  'PERMISSION_REVOKED',
  'AUDIO_BUSY',
  'AUDIO_SESSION_INTERRUPTED',
  'AUDIO_ROUTE_CHANGED',
  'IO_ERROR',
  'INTERRUPTED',
  'CANCELLED',
  'ENGINE_NOT_READY',
  'INVALID_STATE',
  'INVALID_CONFIG',
  'UNSUPPORTED_FORMAT',
  'TIER_INSUFFICIENT',
  'NETWORK_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'NETWORK_DROPPED',
  'DNS_FAILURE',
  'SERVICE_DOWN',
  'AUTH_FAILED',
  'TOKEN_EXPIRED',
  'QUOTA_EXCEEDED',
  'UNSUPPORTED_LANGUAGE',
  'NO_SPEECH',
  'INTERNAL_ERROR',
];

const mapNativeCodeToClarion = (code: string): ErrorCode =>
  (KNOWN_NATIVE_CODES as ReadonlyArray<string>).includes(code)
    ? (code as ErrorCode)
    : 'UNKNOWN';

const buildNativeAzureConfig = (
  opts: AzureEngineOptions,
  creds: ResolvedAzureCredentials,
): NativeAzureConfig => {
  const r = opts.recognition;
  const a = opts.advanced ?? {};
  return {
    language: r.language,
    emitPartials: r.emitPartials ?? true,
    emitAudioLevel: a.emitAudioLevel ?? false,
    audioLevelIntervalMs: a.audioLevelIntervalMs ?? DEFAULT_AUDIO_LEVEL_INTERVAL_MS,
    subscriptionKey: creds.subscriptionKey,
    region: creds.region,
    authToken: creds.authToken,
    endpoint: creds.endpoint,
    outputFormat: r.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    profanity: r.profanity ?? DEFAULT_PROFANITY,
    enableSpeakerDiarization: r.enableSpeakerDiarization ?? false,
    autoDetectLanguages: (r.autoDetectLanguages ?? []).join(','),
    silenceTimeoutMs: r.silenceTimeoutMs ?? 0,
    // Use newline as separator — phrases may legitimately contain commas / spaces.
    phraseHints: (r.phraseHints ?? []).join('\n'),
    degradeOnTierMismatch: r.degradeOnTierMismatch ?? false,
  };
};

const generateSessionId = (): string => {
  // Cheap UUIDv4-ish — good enough for analytics keys (no crypto requirement).
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
};
