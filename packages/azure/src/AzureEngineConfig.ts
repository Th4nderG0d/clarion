import { ClarionError, type ErrorCode } from '@clarionhq/core';

/**
 * Public options for `new AzureEngine(...)`. The flat 0.1.x shape is still
 * accepted via {@link normalizeAzureEngineOptions} with a one-shot warning.
 */
export interface AzureEngineOptions {
  /** Authentication mode. Pick one of the four variants. */
  auth: AzureAuth;
  /** What + how to recognize. */
  recognition: AzureRecognition;
  /** Advanced knobs — every field optional, sensible defaults. */
  advanced?: AzureAdvanced;
  /** Lifecycle telemetry callbacks for analytics + monitoring. */
  telemetry?: AzureTelemetry;
}

/** Authentication mode — exactly one variant required. */
export type AzureAuth =
  /** Ship the subscription key in the app (simplest, fine for prototypes). */
  | { subscriptionKey: string; region: string }
  /** Short-lived authorization token from your server (recommended). */
  | { authToken: string; region: string }
  /**
   * Asynchronous token provider — Clarion calls it whenever a fresh token is
   * needed (initial connect + ~30s before expiry + after a TOKEN_EXPIRED error).
   * The provider should fetch a token from your backend.
   */
  | { tokenProvider: () => Promise<string>; region: string; tokenTtlMs?: number }
  /** Custom endpoint URL (sovereign cloud, custom speech model, private endpoint). */
  | { endpoint: string; subscriptionKey?: string; authToken?: string };

export interface AzureRecognition {
  /** BCP-47 tag, e.g. "en-US", "es-MX". */
  language: string;
  /** Emit interim transcripts as the user speaks. Default: `true`. */
  emitPartials?: boolean;
  /** Debounce `'partial'` events to smooth flicker. Azure fires 5-10×/sec. `0` disables. Default: `100` ms. */
  partialDebounceMs?: number;
  /**
   * Emit an `'audio-confidence'` event on every final whose aggregate
   * confidence is below this threshold (0–1). Lets UIs surface "audio
   * quality looks poor — speak closer to the mic" hints. Default: `0`
   * (disabled).
   */
  lowConfidenceThreshold?: number;
  /**
   * Auto-stop the session after N ms of silence (server-side VAD on Azure's
   * end-silence-timeout). Useful for "release-to-stop" voice UIs and to
   * cap cost when users forget to stop. `0` disables. Default: `0`.
   */
  silenceTimeoutMs?: number;
  /** Bias recognition toward specific phrases via `SPXPhraseListGrammar`. Default: `[]`. */
  phraseHints?: readonly string[];
  /** `'simple'` returns text only; `'detailed'` enables word-level segments + confidence. Default: `'detailed'`. */
  outputFormat?: AzureOutputFormat;
  /** Profanity policy. Default: `'masked'`. */
  profanity?: AzureProfanityFilter;
  /** Enable speaker diarization (Azure conversation transcriber). Requires S0 tier + en-US. Default: `false`. */
  enableSpeakerDiarization?: boolean;
  /**
   * If `enableSpeakerDiarization` is true but the SDK refuses (e.g. F0 tier),
   * silently fall back to non-diarization mode and emit a `DEGRADED_MODE`
   * warning instead of failing prepare(). Default: `false`.
   */
  degradeOnTierMismatch?: boolean;
  /** BCP-47 candidates for auto language detection. Empty = disabled. */
  autoDetectLanguages?: readonly string[];
}

export interface AzureAdvanced {
  /** Emit `audio-level` events for a VU-style meter. Currently ignored on Azure (SDK owns the mic). Default: `false`. */
  emitAudioLevel?: boolean;
  /** Throttle in ms for `audio-level` events. Default: `50`. */
  audioLevelIntervalMs?: number;
  /** Auto-retry config for transient failures in prepare() / start(). Default: off. */
  autoRetry?: AzureAutoRetryConfig;
  /**
   * Hard timeout for `prepare()` — if the WebSocket handshake to Azure hasn't
   * completed within this window, prepare() rejects with `NETWORK_TIMEOUT`.
   * Stops the engine from hanging forever on slow / blocked networks.
   * Default: `15_000` (15 seconds).
   */
  prepareTimeoutMs?: number;
  /**
   * Allow multiple `AzureEngine` instances in the same JS context.
   * Default: `false` — second instance throws `INVALID_STATE` with a hint.
   * Set to `true` if your app legitimately needs parallel sessions (rare).
   */
  allowMultipleInstances?: boolean;
  /** Auto-stop on app background + emit `BACKGROUNDED` warning. No auto-resume. Default: `true`. */
  autoStopOnBackground?: boolean;
  /** Max clock skew vs real time before surfacing `INVALID_CONFIG`. `0` disables. Default: 5 min. */
  maxClockSkewMs?: number;
  /** Skip the JS-side `/issueToken` pre-flight (sovereign clouds where the token endpoint is unreachable). Default: `false`. */
  skipAuthPreflight?: boolean;
  /** Persist phrase finals so a mid-session crash can be recovered via `engine.replay(sessionId)`. */
  persistFinals?: PersistFinalsConfig;
}

/** Minimal storage interface — compatible with AsyncStorage, MMKV, localStorage, etc. */
export interface PersistFinalsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PersistFinalsConfig {
  /** Where to write. */
  storage: PersistFinalsStorage;
  /** Key prefix for stored sessions. Default: `'clarion-azure-session-'`. */
  keyPrefix?: string;
}

export interface AzureAutoRetryConfig {
  /** How many additional attempts after the first failure. `0` = no retry. Default: `0`. */
  maxAttempts?: number;
  /** First-retry delay; doubles each attempt. Default: `500` ms. */
  baseDelayMs?: number;
  /** Error codes that trigger a retry. Default: transient network/service codes. */
  retryOn?: ReadonlyArray<ErrorCode>;
}

export interface AzureTelemetry {
  /** Fired when a session begins recording. */
  onSessionStart?: (info: { sessionId: string; language: string }) => void;
  /** Fired when a session terminates (stop / discard / error / release). */
  onSessionEnd?: (info: {
    sessionId: string;
    phraseCount: number;
    durationMs: number;
    hadError: boolean;
    reason: 'stop' | 'discard' | 'error' | 'release';
  }) => void;
  /** Fired for every error emitted by the engine. */
  onError?: (error: import('@clarionhq/core').ClarionError) => void;
  /** Fired for every warning emitted by the engine. */
  onWarning?: (warning: import('@clarionhq/core').ClarionWarning) => void;
  /**
   * Fired periodically during an active session with the running session
   * duration. Useful for showing "you've used X of 5 free hours this month"
   * UIs by accumulating across sessions on your side.
   * Default cadence: every 30 s while recording. The final tick fires from
   * `onSessionEnd`'s summary, so this is purely for in-session updates.
   */
  onUsageUpdate?: (info: { sessionId: string; elapsedMs: number }) => void;
}

export type AzureOutputFormat = 'simple' | 'detailed';
export type AzureProfanityFilter = 'masked' | 'removed' | 'raw' | 'none';

// Flat-shape back-compat (0.1.x → 0.2.x)

/** Flat options shape from 0.1.x — accepted with a deprecation warning. */
export interface FlatAzureEngineOptions {
  language: string;
  subscriptionKey?: string;
  region?: string;
  authToken?: string;
  endpoint?: string;
  emitPartials?: boolean;
  emitAudioLevel?: boolean;
  audioLevelIntervalMs?: number;
  outputFormat?: AzureOutputFormat;
  profanity?: AzureProfanityFilter;
  enableSpeakerDiarization?: boolean;
  autoDetectLanguages?: readonly string[];
}

/**
 * Accepts either the new grouped shape or the legacy flat shape from 0.1.x.
 * Returns the canonical [[AzureEngineOptions]] and (when flat shape was
 * detected) logs a one-shot console.warn so 0.1.x callers know to migrate.
 */
export const normalizeAzureEngineOptions = (
  raw: AzureEngineOptions | FlatAzureEngineOptions,
): AzureEngineOptions => {
  // Distinguish by presence of `auth` (top-level key only in the new shape).
  if ('auth' in raw && raw.auth !== undefined) {
    return raw as AzureEngineOptions;
  }

  const flat = raw as FlatAzureEngineOptions;
  warnDeprecatedFlatShape();

  const auth: AzureAuth = (() => {
    if (flat.endpoint && flat.endpoint.length > 0) {
      const e: { endpoint: string; subscriptionKey?: string; authToken?: string } = {
        endpoint: flat.endpoint,
      };
      if (flat.subscriptionKey) e.subscriptionKey = flat.subscriptionKey;
      if (flat.authToken) e.authToken = flat.authToken;
      return e;
    }
    if (flat.authToken && flat.region) {
      return { authToken: flat.authToken, region: flat.region };
    }
    if (flat.subscriptionKey && flat.region) {
      return { subscriptionKey: flat.subscriptionKey, region: flat.region };
    }
    // Validation will reject this; we surface a typed error from
    // validateAzureAuthMode() in the engine constructor.
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message:
        'AzureEngine: legacy flat options need one of (subscriptionKey + region), (authToken + region), or endpoint.',
      where: 'config-validation',
    });
  })();

  const recognition: AzureRecognition = { language: flat.language };
  if (flat.emitPartials !== undefined) recognition.emitPartials = flat.emitPartials;
  if (flat.outputFormat !== undefined) recognition.outputFormat = flat.outputFormat;
  if (flat.profanity !== undefined) recognition.profanity = flat.profanity;
  if (flat.enableSpeakerDiarization !== undefined) {
    recognition.enableSpeakerDiarization = flat.enableSpeakerDiarization;
  }
  if (flat.autoDetectLanguages !== undefined) {
    recognition.autoDetectLanguages = flat.autoDetectLanguages;
  }

  const advanced: AzureAdvanced = {};
  if (flat.emitAudioLevel !== undefined) advanced.emitAudioLevel = flat.emitAudioLevel;
  if (flat.audioLevelIntervalMs !== undefined) {
    advanced.audioLevelIntervalMs = flat.audioLevelIntervalMs;
  }

  return { auth, recognition, advanced };
};

let _warnedFlat = false;
const warnDeprecatedFlatShape = (): void => {
  if (_warnedFlat) return;
  _warnedFlat = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[@clarionhq/azure] The flat options shape is deprecated and will be removed in 1.0. ' +
      'Migrate to the grouped shape: ' +
      '`new AzureEngine({ auth: { subscriptionKey, region }, recognition: { language } })`. ' +
      'See https://github.com/Th4nderG0d/clarion/blob/main/packages/azure/CHANGELOG.md',
  );
};

// Auth-mode helpers (consumed by the engine + native config builder)

/**
 * Pull credentials out of an [[AzureAuth]] variant into a flat record the
 * native bridge can consume. `tokenProvider` mode is collapsed to `{ authToken }`
 * once the provider has been called.
 */
export interface ResolvedAzureCredentials {
  subscriptionKey: string;
  region: string;
  authToken: string;
  endpoint: string;
}

export const resolveCredentials = (
  auth: AzureAuth,
  currentToken: string | null,
): ResolvedAzureCredentials => {
  const out: ResolvedAzureCredentials = {
    subscriptionKey: '',
    region: '',
    authToken: '',
    endpoint: '',
  };
  if ('endpoint' in auth) {
    out.endpoint = auth.endpoint;
    if (auth.subscriptionKey) out.subscriptionKey = auth.subscriptionKey;
    if (auth.authToken) out.authToken = auth.authToken;
    return out;
  }
  if ('subscriptionKey' in auth) {
    out.subscriptionKey = auth.subscriptionKey;
    out.region = auth.region;
    return out;
  }
  if ('authToken' in auth) {
    out.authToken = auth.authToken;
    out.region = auth.region;
    return out;
  }
  // tokenProvider mode
  out.region = auth.region;
  out.authToken = currentToken ?? '';
  return out;
};

/** True when the auth mode is `tokenProvider` — used by the engine to know when to start the refresh timer. */
export const isTokenProviderAuth = (
  auth: AzureAuth,
): auth is { tokenProvider: () => Promise<string>; region: string; tokenTtlMs?: number } =>
  typeof (auth as { tokenProvider?: unknown }).tokenProvider === 'function';
