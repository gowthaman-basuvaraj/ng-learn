import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize, share } from 'rxjs';
import { DEDUP } from '../http-context';
import { InflightRegistry } from '../inflight-registry';

/**
 * Collapses identical concurrent GETs into one network request.
 *
 * Three components asking for /api/instruments in the same tick get ONE request, and all three
 * receive the response. This is NOT a cache: once the request settles the entry is removed, and
 * the next call goes to the network again. (Caching is a store's job - see QuotesStore.)
 *
 * Subtleties worth knowing:
 *  - `share()` refcounts subscribers. If one caller unsubscribes (its component is destroyed)
 *    the request keeps going for the others. Only when ALL callers unsubscribe is the
 *    underlying XHR/fetch cancelled.
 *  - The key includes responseType: the same URL fetched as 'json' and as 'blob' must not share.
 *  - Headers aren't in the key on purpose. Auth is added further down the chain, so it's the same
 *    for everyone. If your app varies GETs by custom headers, add them to the key.
 */
export const dedupInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET' || !req.context.get(DEDUP)) return next(req);

  const registry = inject(InflightRegistry);
  const key = `${req.responseType}|${req.urlWithParams}`;

  const existing = registry.get(key);
  if (existing) return existing;

  const shared$ = next(req).pipe(
    finalize(() => registry.delete(key)),
    share(),
  );
  registry.set(key, shared$);
  return shared$;
};
