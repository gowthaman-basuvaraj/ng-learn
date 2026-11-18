import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Stamps non-idempotent writes with an Idempotency-Key.
 *
 * Position in the chain matters: this sits OUTSIDE (before) the retry and auth interceptors,
 * so a retried request, or one replayed after a token refresh, carries the SAME key. The
 * server can then recognise the duplicate and return the original result rather than
 * creating a second order. Put it inside the retry interceptor and every retry would get a
 * fresh key, which defeats the point.
 */
export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  if ((req.method === 'POST' || req.method === 'PATCH') && !req.headers.has('Idempotency-Key')) {
    req = req.clone({ setHeaders: { 'Idempotency-Key': crypto.randomUUID() } });
  }
  return next(req);
};
