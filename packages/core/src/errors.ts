export type ErrorCode =
  | 'PERMISSION_DENIED'
  | 'AUDIO_BUSY'
  | 'NETWORK_UNAVAILABLE'
  | 'NETWORK_TIMEOUT'
  | 'AUTH_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'UNSUPPORTED_FORMAT'
  | 'NO_SPEECH'
  | 'INTERRUPTED'
  | 'CANCELLED'
  | 'ENGINE_NOT_READY'
  | 'INVALID_STATE'
  | 'IO_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export interface ClarionErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  recoverable?: boolean;
}

export class ClarionError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(opts: ClarionErrorOptions) {
    super(opts.message);
    this.name = 'ClarionError';
    this.code = opts.code;
    this.recoverable = opts.recoverable ?? false;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export const isClarionError = (e: unknown): e is ClarionError =>
  e instanceof ClarionError;

const KNOWN_CODES: ReadonlyArray<ErrorCode> = [
  'PERMISSION_DENIED',
  'AUDIO_BUSY',
  'NETWORK_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'AUTH_FAILED',
  'QUOTA_EXCEEDED',
  'UNSUPPORTED_LANGUAGE',
  'UNSUPPORTED_FORMAT',
  'NO_SPEECH',
  'INTERRUPTED',
  'CANCELLED',
  'ENGINE_NOT_READY',
  'INVALID_STATE',
  'IO_ERROR',
  'INTERNAL_ERROR',
  'UNKNOWN',
];

/**
 * Parses the `[CODE] message` shape that Clarion's native bridges throw
 * (e.g. Swift's `RecognizerError.description` and Kotlin's `runOrThrow`
 * wrapper). Returns null if the input doesn't match — callers should
 * fall back to a generic `INTERNAL_ERROR` in that case.
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
): ClarionError => {
  if (err instanceof ClarionError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const parsed = parseNativeErrorMessage(raw);
  if (parsed) {
    return new ClarionError({
      code: parsed.code,
      message: parsed.message,
      cause: err,
    });
  }
  return new ClarionError({
    code: 'INTERNAL_ERROR',
    message: `${fallbackContext}: ${raw}`,
    cause: err,
  });
};
