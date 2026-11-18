import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * HttpContextTokens are per-request metadata that interceptors read. They are how a caller
 * opts in or out of cross-cutting behaviour without the interceptor sniffing URLs.
 *
 *   http.get(url, { context: withContext({ dedup: false, silent: true }) })
 */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);
/** GETs are deduplicated by default; set false for "I really want a fresh request". */
export const DEDUP = new HttpContextToken<boolean>(() => true);
/** Overrides the default retry count for this request (0 = never retry). */
export const RETRY_ATTEMPTS = new HttpContextToken<number | null>(() => null);
/** Don't toast on failure: the caller renders the error inline. */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);
/** Don't drive the global progress bar (e.g. background polling). */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

export interface RequestOptions {
  skipAuth?: boolean;
  dedup?: boolean;
  retry?: number;
  silent?: boolean;
  skipLoading?: boolean;
}

/** Small ergonomic helper so call sites read like config, not plumbing. */
export function withContext(opts: RequestOptions, ctx = new HttpContext()): HttpContext {
  if (opts.skipAuth !== undefined) ctx.set(SKIP_AUTH, opts.skipAuth);
  if (opts.dedup !== undefined) ctx.set(DEDUP, opts.dedup);
  if (opts.retry !== undefined) ctx.set(RETRY_ATTEMPTS, opts.retry);
  if (opts.silent !== undefined) ctx.set(SILENT_ERRORS, opts.silent);
  if (opts.skipLoading !== undefined) ctx.set(SKIP_LOADING, opts.skipLoading);
  return ctx;
}
