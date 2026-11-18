import { authInterceptor } from './auth.interceptor';
import { dedupInterceptor } from './dedup.interceptor';
import { errorInterceptor } from './error.interceptor';
import { idempotencyInterceptor } from './idempotency.interceptor';
import { loadingInterceptor } from './loading.interceptor';
import { retryInterceptor } from './retry.interceptor';

/**
 * ORDER MATTERS. The first entry is the outermost layer: it sees the request first and the
 * response last. Read it as an onion:
 *
 *   dedup        -> outermost, so duplicate callers share EVERYTHING below (one spinner tick,
 *                   one toast, one refresh, one retry loop)
 *   loading      -> counts one logical request, however many retries happen underneath
 *   error        -> sees the FINAL outcome (after refresh and retries), normalises it to ApiError, toasts once
 *   idempotency  -> stamps the key before auth/retry, so replays reuse the same key
 *   auth         -> bearer token + 401 -> single-flight refresh -> replay
 *   retry        -> innermost: each attempt is a real network call
 *   (backend)
 */
export const appInterceptors = [
  dedupInterceptor,
  loadingInterceptor,
  errorInterceptor,
  idempotencyInterceptor,
  authInterceptor,
  retryInterceptor,
];
