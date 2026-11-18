import { HttpErrorResponse } from '@angular/common/http';

/**
 * One error shape for the whole app. Components never deal with HttpErrorResponse directly,
 * so swapping the backend's error format touches exactly one function.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork() {
    return this.status === 0;
  }
  get isRetryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof HttpErrorResponse) {
      const body = (err.error ?? {}) as { code?: string; message?: string; fieldErrors?: Record<string, string> };
      if (err.status === 0) return new ApiError(0, 'NETWORK', 'Network unreachable - is the mock API running?', {}, err);
      return new ApiError(err.status, body.code ?? `HTTP_${err.status}`, body.message ?? err.message, body.fieldErrors ?? {}, err);
    }
    return new ApiError(-1, 'UNKNOWN', err instanceof Error ? err.message : String(err), {}, err);
  }
}
