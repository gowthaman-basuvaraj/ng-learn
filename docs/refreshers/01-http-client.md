# HttpClient refresher (Angular 21)

> One-line mental model: **HttpClient returns a *cold* Observable that runs a request through an interceptor chain to a
> backend (XHR or fetch). Nothing happens until you subscribe; unsubscribing cancels the request.**

Repo references: `src/app/core/http/**`, `src/app/domain/*-api.ts`, specs in `core/http/interceptors/*.spec.ts`.

---

## 1. Setup

```ts
// app.config.ts
provideHttpClient(
  withFetch(),                         // use fetch() instead of XHR (better for SSR; no upload progress)
  withInterceptors([a, b, c]),         // functional interceptors, outer → inner
  // withInterceptorsFromDi(),         // legacy class interceptors registered via HTTP_INTERCEPTORS
  // withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
  // withNoXsrfProtection(),
  // withJsonpSupport(),
  // withRequestsMadeViaParent(),      // in a lazy injector: also run the PARENT's interceptors
)
```

Facts worth knowing (checked against v21 source):
- **XHR is still the default backend.** `withFetch()` opts into fetch.
- `HttpClient` is `providedIn: 'root'` in v21, so you can inject it without `provideHttpClient()`, but then you get no
  interceptors and no configuration. Real apps always call `provideHttpClient(...)`.
- Legacy code: `HttpClientModule` + class interceptors (`implements HttpInterceptor`) registered with
  `{ provide: HTTP_INTERCEPTORS, useClass: X, multi: true }`. Same concept, older wiring.
- Built-in XSRF: for mutating requests to *relative* URLs, Angular reads the `XSRF-TOKEN` cookie and sends an
  `X-XSRF-TOKEN` header. The server has to cooperate.

---

## 2. Making requests

```ts
private http = inject(HttpClient);

this.http.get<Instrument[]>('/api/instruments');                         // body as JSON, typed
this.http.get<PricePoint[]>(url, { params: { points: 90 } });            // query params
this.http.post<Order>('/api/orders', draft);                             // body is JSON-serialised
this.http.put<T>(url, body); this.http.patch<T>(url, body); this.http.delete<T>(url);
this.http.request<T>('GET', url, options);                               // generic form
```

### The options object

| Option | What it does |
|---|---|
| `params` | `HttpParams` or a plain object `{ a: 1, tags: ['x','y'] }`, encoded for you |
| `headers` | `HttpHeaders` or a plain object |
| `observe` | `'body'` (default), `'response'` (gives `HttpResponse<T>` with status and headers), `'events'` (every `HttpEvent`) |
| `responseType` | `'json'` (default), `'text'`, `'blob'`, `'arraybuffer'` |
| `reportProgress` | emit progress events (with `observe: 'events'`). Upload progress is XHR-only |
| `context` | `HttpContext`: per-request metadata for interceptors (see §5) |
| `withCredentials` | send cookies cross-origin |
| `timeout` | ms before the request errors (v20+) |
| `transferCache` | SSR: reuse the server's response during hydration |
| fetch-only | `keepalive`, `priority`, `cache`, `credentials`, `mode`, `redirect`, `referrer`, `integrity` |

```ts
// Need status or headers? observe: 'response'
this.http.get<Order[]>('/api/orders', { observe: 'response' })
  .subscribe(res => console.log(res.status, res.headers.get('X-Total-Count'), res.body));

// Download a file
this.http.get('/api/report', { responseType: 'blob' });
```

**The type parameter is a promise, not a check.** `get<User>()` doesn't validate anything at runtime. If the backend
is untrusted, validate with zod/valibot in the API client (or `httpResource`'s `parse` option).

### Immutability
`HttpRequest`, `HttpHeaders` and `HttpParams` are **immutable**. `.set()`/`.append()` return a *new* instance:

```ts
let params = new HttpParams();
params.set('a', '1');            // ❌ result discarded
params = params.set('a', '1');   // ✅
req = req.clone({ setHeaders: { Authorization: `Bearer ${t}` }, setParams: { v: '2' } });
```

---

## 3. The Observable semantics (where people get bitten)

1. **Cold.** No subscribe = no request. `this.http.post(...)` on its own line does *nothing*.
2. **Every subscribe = a new request.** Two `| async` pipes on the same observable → two requests. Fix it with `share()`,
   a store, or `toSignal` once.
3. **Emits once, then completes** (with the default `observe: 'body'`). No manual unsubscribe is needed for a *completed*
   request, but you **should** still tie it to a lifetime (`takeUntilDestroyed`, `toSignal`, `async`) so that
   **unsubscribe = cancel** when the user navigates away mid-request.
4. **Errors are `HttpErrorResponse`**: `status` (`0` = network/CORS/aborted), `error` (parsed body), `headers`, `url`.
   A 4xx/5xx is an *error notification*, not a value.

```ts
// Cancellation: switchMap aborts the previous request (typeahead)
this.query$.pipe(
  debounceTime(250),
  distinctUntilChanged(),
  switchMap(q => this.api.search(q)),     // the previous XHR/fetch is aborted
);

// Promise interop (async/await code)
const order = await firstValueFrom(this.api.placeOrder(draft));   // see OrdersStore.place()
```

Choosing the flattening operator for requests:

| Operator | Behaviour | Use for |
|---|---|---|
| `switchMap` | cancel previous | search, "load for the current selection" |
| `concatMap` | queue | ordered writes |
| `mergeMap` | parallel | independent actions (cancel order A *and* B) |
| `exhaustMap` | ignore while busy | submit buttons, "load once" |

---

## 4. Interceptors

```ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).accessToken();           // inject() works here: it's an injection context
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};
```

- A function `(req, next) => Observable<HttpEvent<unknown>>`. Change the request *before* `next`, and the response
  stream *after* (`pipe(...)` on `next(req)`).
- **Order:** the first in the array is the **outermost** layer. It sees the request first and the response last.
- Interceptors see **events**, not bodies. To touch the response: `filter(e => e instanceof HttpResponse)` or
  `map(e => e instanceof HttpResponse ? e.clone({ body: ... }) : e)`.
- `next(req)` is cold too: `retry()` on it **re-sends** the request. That's exactly how the retry interceptor works.
- Short-circuit: return `of(new HttpResponse({ status: 200, body }))` without calling `next` (mocks, caches).

### This repo's chain and why the order matters

```
dedup → loading → error → idempotency → auth → retry → backend
```

| Interceptor | Job | Why at this position |
|---|---|---|
| `dedup` | identical concurrent GETs share one request | outermost, so the duplicates share everything below |
| `loading` | global in-flight counter, drives the progress bar | counts one logical request, however many retries |
| `error` | normalises to `ApiError`, toasts once | sees the *final* result after refresh and retries |
| `idempotency` | adds `Idempotency-Key` to POST/PATCH | before retry/auth, so replays reuse the same key |
| `auth` | bearer, then 401 → single-flight refresh → replay | outside retry, so a 401 isn't retried blindly |
| `retry` | backoff + jitter on 0/429/5xx, safe methods only | innermost: each attempt is a real call |

Exercise: swap two of them and predict what breaks before running `npm test`.

---

## 5. HttpContext: per-request options for interceptors

```ts
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);   // default value factory

// caller
this.http.get(url, { context: new HttpContext().set(SILENT_ERRORS, true) });
// this repo's helper
this.http.get(url, { context: withContext({ silent: true, dedup: false, retry: 0 }) });

// interceptor
if (req.context.get(SILENT_ERRORS)) { ... }
```

This beats sniffing URLs inside interceptors (`if (req.url.includes('/auth'))`), which is brittle and invisible to callers.

---

## 6. Patterns you should be able to explain

### Error normalisation
Turn every failure into one app-level type (`ApiError`: status, code, message, fieldErrors) in one place. Components
never import `HttpErrorResponse`. 422 field errors go onto form controls (`order-ticket.ts`). 401 belongs to the auth flow.
Everything else gets a toast, coalesced so that 6 failures show 1 toast.

### Retry
`retry({ count, delay: (err, n) => isTransient(err) ? timer(backoff(n)) : throwError(() => err) })`.
Only safe/idempotent requests. Honour `Retry-After`. Add jitter to avoid a thundering herd.

### Deduplication vs caching
- **Dedup:** share *in-flight* requests. Removed on settle. No staleness questions.
- **Cache:** keep *settled* responses. Needs TTL, invalidation, and a decision about stale-while-revalidate. Put it in a
  store or query layer, not in an interceptor that doesn't know the domain.

### Token refresh (the senior question)
Problem: N requests get 401 at once → N refreshes → with rotating refresh tokens, N−1 fail → random logouts.
Fix (`auth.interceptor.ts` + `AuthService.refresh`):
1. Refresh is **single-flight**: one shared `Observable` (`shareReplay({bufferSize:1, refCount:false})`), cleared in `finalize`.
2. Requests started *during* a refresh wait for it (`currentToken()`).
3. A 401 for a token that's *already been rotated* retries with the current token and doesn't refresh again.
4. Log out only on a definitive refresh rejection (401/400), **never on a network error**.

### Idempotency
Keys generated client-side (`crypto.randomUUID()`), stored by the server with the result. Same key → same response, so it's
safe to retry POSTs and safe against double-clicks.

---

## 7. `httpResource` and `resource` (signals-native, still experimental in v21)

```ts
// re-fetches whenever symbol() or range() changes; cancels the stale request; goes through interceptors
history = httpResource<PricePoint[]>(
  () => ({ url: `/api/instruments/${this.symbol()}/history`, params: { points: this.range() } }),
  { defaultValue: [] /* parse: zodSchema.parse, equal: ... */ },
);

history.value();      // T (THROWS in the error state, so check first)
history.hasValue();   history.error();   history.isLoading();
history.status();     // 'idle' | 'loading' | 'reloading' | 'resolved' | 'error' | 'local'
history.reload();     history.set(v) / update(fn)   // local optimistic overrides
history.headers();    history.statusCode();   history.progress();
httpResource.text(...)  / .blob(...)  / .arrayBuffer(...)
```

- Return `undefined` from the request function to **not** fetch (e.g. no id yet).
- It's built for **reads**. Do mutations with `HttpClient` (Observable or `firstValueFrom`).
- `resource({ params, loader })` is the generic version, for any async source.
- Interview phrasing: *"It's Angular's built-in answer to `useQuery`, minus the cache. Production codebases mostly
  still use HttpClient + RxJS or NgRx, so I know both."*

---

## 8. Testing HTTP

```ts
TestBed.configureTestingModule({
  providers: [provideHttpClient(withInterceptors([dedupInterceptor])), provideHttpClientTesting()],
});
const http = TestBed.inject(HttpClient);
const backend = TestBed.inject(HttpTestingController);

http.get('/api/x').subscribe(r => result = r);
const req = backend.expectOne('/api/x');        // fails on 0 or 2+ matches
expect(req.request.headers.get('Authorization')).toBe('Bearer at1');
req.flush({ ok: 1 });                           // or flush(body, { status: 401, statusText: 'Unauthorized' })
// req.error(new ProgressEvent('error'))        // network error (status 0)
backend.expectNone('/api/y');  backend.match('/api/x');   // array
afterEach(() => backend.verify());              // no unexpected open requests
```

- Order matters: `provideHttpClientTesting()` **after** `provideHttpClient()`.
- Retries with delays: `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(ms)` (see `retry.interceptor.spec.ts`).
- A cancelled request stays in the list with `req.cancelled === true`, and `verify()` ignores it by default.

---

## 9. Rapid-fire Q&A

- **Why is my request not firing?** Nobody subscribed.
- **Why are there two requests?** Two subscriptions (two `async` pipes, or subscribe + toSignal). Share it or use a store.
- **How do you cancel?** Unsubscribe (`switchMap`, `takeUntilDestroyed`, component destroy via `toSignal`).
- **`status: 0`?** Network failure, CORS, or an aborted request. There's no HTTP response at all.
- **Where does the error toast belong?** One error interceptor plus per-request opt-out, never scattered across components.
- **Class vs functional interceptors?** Functional (`withInterceptors`) is the modern default. Class interceptors need
  `withInterceptorsFromDi()`. Both can coexist.
- **Fetch vs XHR?** Fetch is better for SSR/streaming and has fetch-only options. XHR has upload progress.
