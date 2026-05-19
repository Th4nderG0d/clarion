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
