/**
 * Typed error codes surfaced by every Clarion engine. Codes are stable across
 * engines so callers can pattern-match without knowing which engine produced
 * the error. New codes appended to the end of the union to avoid breaking
 * exhaustive switches in older consumers.
 */
export type ErrorCode =
  // Auth + config
  | 'PERMISSION_DENIED'
  | 'PERMISSION_REVOKED'        // Mid-session permission loss (foreground re-check).
  | 'AUTH_FAILED'
  | 'TOKEN_EXPIRED'             // Specifically: an auth token's TTL elapsed.
  | 'INVALID_CONFIG'            // Pre-flight validation failure (JS or native).
  // Audio
  | 'AUDIO_BUSY'                // Another app/process holds the mic.
  | 'AUDIO_SESSION_INTERRUPTED' // Phone call / Siri / alarm cut in mid-session.
  | 'AUDIO_ROUTE_CHANGED'       // Bluetooth/wired/internal mic swap mid-session.
  | 'NO_SPEECH'
  // Network
  | 'NETWORK_UNAVAILABLE'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_DROPPED'           // Mid-session connectivity loss.
  | 'DNS_FAILURE'
  | 'SERVICE_DOWN'              // 503 / region maintenance.
  // Service quotas
  | 'QUOTA_EXCEEDED'
  | 'TIER_INSUFFICIENT'         // Feature requires a higher pricing tier (e.g., diarization on F0).
  | 'UNSUPPORTED_LANGUAGE'
  | 'UNSUPPORTED_FORMAT'
  // Storage / IO
  | 'IO_ERROR'
  | 'STORAGE_FULL'
  // Lifecycle / state
  | 'INTERRUPTED'
  | 'CANCELLED'
  | 'ENGINE_NOT_READY'
  | 'INVALID_STATE'
  // Catch-all
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

/** Where in the engine lifecycle the error occurred. Useful for analytics + retry policy. */
export type ErrorOrigin =
  | 'config-validation'
  | 'prepare'
  | 'start'
  | 'mid-session'
  | 'stop'
  | 'discard'
  | 'release'
  | 'unknown';

/**
 * Structured details attached to every error. Fields are optional and additive —
 * older consumers can ignore them safely. Use `details.nativeCode` /
 * `details.nativeDomain` for raw SDK error payloads when filing bug reports.
 */
export interface ClarionErrorDetails {
  /** Raw error code from the underlying native SDK (e.g. SPXCancellationErrorCode rawValue). */
  nativeCode?: number;
  /** Raw error domain / SDK class name (e.g. "kLSRErrorDomain", "MicrosoftCognitiveServicesSpeech"). */
  nativeDomain?: string;
  /** Session id this error belonged to, if any. */
  sessionId?: string;
  /** Azure region in use, if applicable. */
  region?: string;
  /** X-RequestId or equivalent from the service response. */
  requestId?: string;
  /** Free-form extras — anything else the producer wants to expose. */
  [key: string]: unknown;
}

export interface ClarionErrorOptions {
  code: ErrorCode;
  /** Technical message — safe to log, not necessarily safe to show to end users. */
  message: string;
  /** Non-technical, end-user-safe message. UI surfaces should prefer this over `message`. */
  userMessage?: string;
  /** Where in the lifecycle this error happened. */
  where?: ErrorOrigin;
  /** True for transient errors (network blip, throttling) the caller can safely retry. */
  recoverable?: boolean;
  /** Hint for caller's backoff timer when `recoverable: true`. */
  retryAfterMs?: number;
  /** True for permission-class errors — UI can deep-link to Settings. */
  openSettings?: boolean;
  /** Structured details for analytics / bug reports. */
  details?: ClarionErrorDetails;
  /** Underlying cause (NSError, JNI throwable, etc.). */
  cause?: unknown;
}

export class ClarionError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  readonly userMessage?: string;
  readonly where?: ErrorOrigin;
  readonly retryAfterMs?: number;
  readonly openSettings?: boolean;
  readonly details?: ClarionErrorDetails;
  override readonly cause?: unknown;

  constructor(opts: ClarionErrorOptions) {
    super(opts.message);
    this.name = 'ClarionError';
    this.code = opts.code;
    this.recoverable = opts.recoverable ?? false;
    if (opts.userMessage !== undefined) this.userMessage = opts.userMessage;
    if (opts.where !== undefined) this.where = opts.where;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts.openSettings !== undefined) this.openSettings = opts.openSettings;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  /**
   * JSON-safe serialization. Strips `cause` (often non-serializable) and
   * surfaces just the fields a logger / analytics pipeline cares about.
   */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.userMessage !== undefined) out.userMessage = this.userMessage;
    if (this.where !== undefined) out.where = this.where;
    if (this.retryAfterMs !== undefined) out.retryAfterMs = this.retryAfterMs;
    if (this.openSettings !== undefined) out.openSettings = this.openSettings;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export const isClarionError = (e: unknown): e is ClarionError =>
  e instanceof ClarionError;

const KNOWN_CODES: ReadonlyArray<ErrorCode> = [
  'PERMISSION_DENIED',
  'PERMISSION_REVOKED',
  'AUTH_FAILED',
  'TOKEN_EXPIRED',
  'INVALID_CONFIG',
  'AUDIO_BUSY',
  'AUDIO_SESSION_INTERRUPTED',
  'AUDIO_ROUTE_CHANGED',
  'NO_SPEECH',
  'NETWORK_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'NETWORK_DROPPED',
  'DNS_FAILURE',
  'SERVICE_DOWN',
  'QUOTA_EXCEEDED',
  'TIER_INSUFFICIENT',
  'UNSUPPORTED_LANGUAGE',
  'UNSUPPORTED_FORMAT',
  'IO_ERROR',
  'STORAGE_FULL',
  'INTERRUPTED',
  'CANCELLED',
  'ENGINE_NOT_READY',
  'INVALID_STATE',
  'INTERNAL_ERROR',
  'UNKNOWN',
];

/**
 * Parses the `[CODE] message` shape that Clarion's native bridges throw
 * (e.g. Swift's `RecognizerError.description` and Kotlin's `runOrThrow`
 * wrapper). Returns null if the input doesn't match — callers should fall
 * back to a generic `INTERNAL_ERROR` in that case.
 */
export const parseNativeErrorMessage = (
  raw: string,
): { code: ErrorCode; message: string } | null => {
  const match = raw.match(/\[([A-Z_]+)\]\s*(.*)/);
  if (!match || !match[1]) return null;
  const code = match[1] as ErrorCode;
  if (!KNOWN_CODES.includes(code)) return null;
  return { code, message: match[2] ?? raw };
};

/**
 * Wraps an arbitrary native-bridge throwable into a `ClarionError`, preserving
 * the `[CODE] message` shape when present. Use this from engine `catch` blocks
 * so callers see a typed error instead of a generic INTERNAL_ERROR.
 */
export const fromNativeError = (
  err: unknown,
  fallbackContext: string,
  where: ErrorOrigin = 'unknown',
): ClarionError => {
  if (err instanceof ClarionError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const parsed = parseNativeErrorMessage(raw);
  if (parsed) {
    return new ClarionError({
      code: parsed.code,
      message: parsed.message,
      where,
      cause: err,
    });
  }
  return new ClarionError({
    code: 'INTERNAL_ERROR',
    message: `${fallbackContext}: ${raw}`,
    where,
    cause: err,
  });
};

/**
 * Default user-facing messages for each error code. Engines/UIs can override
 * with localized strings — these are the fallback when no `userMessage` was
 * supplied at construction time.
 */
export const defaultUserMessage = (code: ErrorCode): string => {
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'Microphone permission is required. Please grant it in Settings.';
    case 'PERMISSION_REVOKED':
      return 'Microphone permission was turned off. Please re-enable it in Settings.';
    case 'AUTH_FAILED':
      return 'Authentication failed. Check your credentials.';
    case 'TOKEN_EXPIRED':
      return 'Your session expired. Please reconnect.';
    case 'INVALID_CONFIG':
      return 'Invalid configuration. Please check the values you provided.';
    case 'AUDIO_BUSY':
      return 'The microphone is in use by another app.';
    case 'AUDIO_SESSION_INTERRUPTED':
      return 'Recording was interrupted by a call or alarm.';
    case 'AUDIO_ROUTE_CHANGED':
      return 'Audio device changed. Please try again.';
    case 'NO_SPEECH':
      return 'No speech was detected.';
    case 'NETWORK_UNAVAILABLE':
    case 'NETWORK_DROPPED':
    case 'DNS_FAILURE':
      return 'Network is unavailable. Check your connection.';
    case 'NETWORK_TIMEOUT':
      return 'The connection timed out. Please try again.';
    case 'SERVICE_DOWN':
      return 'The service is temporarily unavailable. Please try again later.';
    case 'QUOTA_EXCEEDED':
      return 'Usage limit reached. Please try again later.';
    case 'TIER_INSUFFICIENT':
      return 'This feature requires a different pricing tier.';
    case 'UNSUPPORTED_LANGUAGE':
      return 'This language is not supported.';
    case 'UNSUPPORTED_FORMAT':
      return 'The audio format is not supported.';
    case 'IO_ERROR':
      return 'Could not read or write the recording file.';
    case 'STORAGE_FULL':
      return 'Storage is full. Free up some space and try again.';
    case 'INTERRUPTED':
      return 'The recording was interrupted.';
    case 'CANCELLED':
      return 'The recording was cancelled.';
    case 'ENGINE_NOT_READY':
    case 'INVALID_STATE':
      return 'Something went wrong. Please try again.';
    case 'INTERNAL_ERROR':
    case 'UNKNOWN':
    default:
      return 'An unexpected error occurred.';
  }
};
