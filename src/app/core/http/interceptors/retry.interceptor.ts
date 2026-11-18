import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { retry, throwError, timer } from 'rxjs';
import { APP_CONFIG } from '../../config/app-config';
import { RETRY_ATTEMPTS } from '../http-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/** Only retry what's safe to repeat: idempotent methods, or writes carrying an Idempotency-Key. */
const isSafeToRetry = (req: HttpRequest<unknown>) => SAFE_METHODS.has(req.method) || req.headers.has('Idempotency-Key');

const isTransient = (err: unknown) =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status === 429 || err.status >= 500);

/**
 * Exponential backoff with jitter for transient failures.
 * Innermost interceptor, so each attempt is a real network call and the outer layers
 * (loading bar, error toast) see a single logical request.
 */
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  const { retry: cfg } = inject(APP_CONFIG);
  const attempts = req.context.get(RETRY_ATTEMPTS) ?? (isSafeToRetry(req) ? cfg.maxAttempts : 0);
  if (attempts <= 0) return next(req);

  return next(req).pipe(
    retry({
      count: attempts,
      delay: (err, retryCount) => {
        if (!isTransient(err)) return throwError(() => err);
        const retryAfter = Number((err as HttpErrorResponse).headers?.get('Retry-After'));
        const backoff = retryAfter > 0 ? retryAfter * 1000 : cfg.baseDelayMs * 2 ** (retryCount - 1);
        const jitter = Math.random() * backoff * 0.3; // spreads out a thundering herd of clients
        return timer(backoff + jitter);
      },
    }),
  );
};
