# RxJS refresher (the subset Angular devs actually use)

> Mental model: **an Observable is a function that, when subscribed, starts producing values over time and returns a
> teardown.** Cold by default, lazy, cancellable.

Repo references: `core/http/interceptors/*`, `core/realtime/*`, `state/*.store.ts` (`rxMethod`),
`features/lab/lab-page.ts`. Testing RxJS is in [11-testing.md](11-testing.md#testing-rxjs).

## 1. If you come from React/Vue

| You know | RxJS | Note |
|---|---|---|
| `Promise` | `Observable` | lazy (nothing runs until `subscribe`), multi-value, **cancellable** |
| `promise.then(fn)` | `obs$.subscribe(fn)` | subscribing is what *starts* the work |
| `AbortController` + `fetch` in `useEffect` | `switchMap` | switching inner streams cancels the previous request |
| `useEffect` cleanup return | `takeUntilDestroyed()` / unsubscribe | cancellation is built into the primitive |
| `lodash.debounce` / VueUse `watchDebounced` | `debounceTime(ms)` | plus `throttleTime`/`auditTime` for the other two flavours |
| `Promise.all([a, b])` | `forkJoin([a$, b$])` | waits for **completion**, not for the first value |
| `await somePromise` | `await firstValueFrom(obs$)` | the escape hatch to async/await |
| React Query / SWR in-flight dedup | `shareReplay({ bufferSize: 1 })` | one shared execution + replay to latecomers |
| `mitt` / an event emitter | `Subject` | push values in, many listeners out |
| `useSyncExternalStore` / `useQuery().data` | `toSignal(obs$)` | the stream becomes template-readable state |
| `.catch()` | `catchError` | **but** it ends the stream unless it sits inside a flattening operator (§8) |
| `provide` / `inject` (Vue) around a stream | a service exposing `Observable`s | lifetime is the injector's |

**"Why not just async/await?"** — the honest answer, and a good one to say out loud: *for a single request that doesn't
need cancelling, `firstValueFrom` + `await` is fine, and that's what `OrdersStore.place()` does because the form needs
the outcome. RxJS earns its keep when there is **time** in the problem: cancellation, debounce, retry with backoff,
merging several sources, batching a socket. Those are three operators here and a page of imperative code with flags
anywhere else.*

## 2. The running example

One scenario runs through this whole document: **the symbol search box on the trading desk**. Every snippet below uses
this cast, so you can compare operators instead of re-reading a new setup each time.

```ts
// Signals (state: what is true now)
readonly query  = signal('');                       // the search input: '' -> 'A' -> 'AP' -> 'AAPL'
readonly symbol = signal('AAPL');                   // the instrument currently on screen

// Cold streams: one execution per subscriber, and they complete (HttpClient)
api.search(q: string):  Observable<Instrument[]>    // GET    /api/instruments?q=
api.quote(s: string):   Observable<Quote>           // GET    /api/quotes/:symbol
api.place(d: Draft):    Observable<Order>           // POST   /api/orders
api.cancel(id: string): Observable<Order>           // DELETE /api/orders/:id

// Hot streams: the producer runs whether or not you subscribe, and they NEVER complete
socket.ticks$:      Observable<Tick>                // one message per price change
events.on('order'): Observable<Order>               // SSE order updates
```

Marble notation below: time runs left to right, `|` is completion, `#` is an error, `@n` is a timestamp in ms.

## 3. Creation

```ts
of(1, 2)                                     // emits 1, 2, completes. Synchronously.
from(fetch(url))                             // Promise -> Observable (also arrays and iterables)
from(['AAPL', 'MSFT'])                       // emits each item, then completes
timer(0, 1000)                               // 0 now, then 1, 2, 3... every second -> a polling clock
interval(1000)                               // same, but no immediate first value
fromEvent(inputEl, 'input')                  // DOM events as a stream
defer(() => api.quote(this.symbol()))        // built at SUBSCRIBE time, so it reads the CURRENT symbol
throwError(() => new Error('nope'))          // an observable that only errors
EMPTY                                        // completes immediately, emits nothing
NEVER                                        // never emits, never completes (useful in a switchMap branch)

new Observable<Tick>(subscriber => {         // wrapping a non-Rx producer (event-stream.service.ts)
  const es = new EventSource('/api/stream');
  es.onmessage = e => subscriber.next(JSON.parse(e.data));
  return () => es.close();                   // <- the teardown: runs on unsubscribe/complete/error
});
```

`defer` is the one people forget: without it, `api.quote(this.symbol())` captures the symbol *when the pipeline is
built*, not when someone subscribes. `loading.interceptor.ts` uses it so the spinner counter moves on subscribe rather
than when the interceptor function runs.

## 4. Transform

```ts
ticks$.pipe(map(t => t.price))                                  // Tick -> number
ticks$.pipe(filter(t => t.symbol === this.symbol()))            // only the instrument on screen
ticks$.pipe(tap(t => console.log('tick', t)))                   // peek without changing anything
ticks$.pipe(scan(count => count + 1, 0))                        // 1, 2, 3, ... a reducer over time
ticks$.pipe(map(t => t.price), pairwise(), map(([was, now]) => now - was))   // move since the last tick
```

`scan` emits on **every** value; `reduce` emits **once, on completion** — so `ticks$.pipe(reduce(...))` never emits at
all, because a socket never completes. Worth remembering as a family: `reduce`, `toArray`, `last()`, `forkJoin` are all
completion-gated and silently do nothing on an infinite source.

## 5. The four flattening operators

```
switchMap  → cancel the previous inner      (typeahead, "load for current route param")
mergeMap   → run all concurrently          (independent actions)
concatMap  → queue, one at a time in order (ordered writes)
exhaustMap → ignore new while one runs     (submit button, "load once")
```

Same code, one word changed. The user types `A`, then `AP`, then `AAPL`, and each search takes 200 ms:

```ts
toObservable(this.query).pipe(switchMap(q => this.api.search(q)));   // swap the operator, nothing else
```

```
typed:           A@0       AP@50       AAPL@100          each request takes 200ms

switchMap   →    AAPL results @300                        (the A and AP requests are CANCELLED)
mergeMap    →    A@200 · AP@250 · AAPL@300                (3 requests in flight, replies race)
concatMap   →    A@200 · AP@400 · AAPL@600                (queued, always in typed order)
exhaustMap  →    A@200                                    (AP and AAPL DROPPED while A was running)
```

Read the failure modes off that diagram: `mergeMap` can paint `A`'s results *after* `AAPL`'s if the server is uneven
(the classic typeahead bug), `concatMap` makes the user wait through stale queries, and `exhaustMap` shows results for
a query the user has already replaced. For a search box, only `switchMap` is right.

They are one knob — concurrency. `concatMap` is `mergeMap(fn, 1)`, `mergeMap` is unlimited, and `mergeMap(fn, 3)` caps
it at three in flight (useful for "upload 50 files, 3 at a time"). `switchMap` and `exhaustMap` are the two that *drop*
work: switch drops the old, exhaust drops the new.

```ts
// switchMap: a newer list wins, and the stale request is cancelled      (OrdersStore.load)
load = rxMethod<void>(pipe(switchMap(() => api.orders().pipe(tapResponse({ /* ... */ })))));

// mergeMap: cancelling order B must NOT abort the request for order A   (OrdersStore.cancel)
cancel = rxMethod<string>(pipe(mergeMap(id => api.cancel(id).pipe(tapResponse({ /* ... */ })))));

// concatMap: writes that must land in order
draftEdits$.pipe(concatMap(edit => api.saveDraft(edit)));

// exhaustMap: double-clicking Submit must place ONE order               (order ticket)
submit = rxMethod<Draft>(pipe(exhaustMap(d => api.place(d).pipe(tapResponse({ /* ... */ })))));
```

## 6. Rate limiting: picking the right one

| Operator | Emits | Use for |
|---|---|---|
| `debounceTime(300)` | the last value **after 300 ms of silence** | search boxes; collapsing a burst of fills into one refetch |
| `throttleTime(300)` | the **first** value, then ignores 300 ms | rate-limiting clicks/scroll; `{ leading, trailing }` picks the edge |
| `auditTime(300)` | the **latest** value at the end of each 300 ms window | "repaint at most 3×/s, with the freshest value" |
| `sampleTime(300)` | the latest value on a fixed 300 ms clock | sampling a continuous stream |
| `bufferTime(100)` | an **array** of the window's values | batching high-frequency ticks into one state write |

Same five prices through each operator, so the difference is visible:

```ts
ticks$.pipe(debounceTime(100));   // ticks arrive: p1@0  p2@30  p3@60  ...quiet...  p4@310  p5@330
```

```
debounceTime(100)  →  p3@160 · p5@430                    only after 100ms of silence; nothing mid-burst
throttleTime(100)  →  p1@0   · p4@310                    leading edge: first value, then a 100ms blackout
auditTime(100)     →  p3@100 · p5@410                    trailing edge: the FRESHEST value of the window
sampleTime(100)    →  p3@100 · p5@400                    on a fixed clock; silent at 200/300 (nothing new)
bufferTime(100)    →  [p1,p2,p3]@100 · []@200 · []@300 · [p4,p5]@400
```

For a price feed you want `auditTime` (freshest) or `bufferTime` (batch), **never** `debounceTime` — a price that keeps
ticking would never be shown at all. For a search box you want `debounceTime`. In this repo:

```ts
// QuotesStore: one state write per 100ms of socket traffic instead of one per message
socket.ticks$.pipe(
  bufferTime(100),
  filter(batch => batch.length > 0),        // bufferTime also emits EMPTY arrays on a quiet window
).subscribe(batch => patchState(store, applyTicks(batch)));

// PortfolioStore: a burst of fills triggers ONE refetch, not one per fill
events.on('order').pipe(filter(o => o.status === 'FILLED'), debounceTime(250), takeUntilDestroyed())
  .subscribe(() => store.load());
```

```ts
ticks$.pipe(distinctUntilChanged());                              // useless: every Tick is a new object
ticks$.pipe(distinctUntilChanged((a, b) => a.price === b.price)); // skip repeats of the same price
ticks$.pipe(distinctUntilKeyChanged('price'));                    // same thing, shorter
```
`distinctUntilChanged()` compares with `Object.is`, so it only works on primitives — on objects rebuilt per emission it
never filters anything. It also compares only against the **previous** value, not everything seen so far.

## 7. Combination

```ts
const price$  = ticks$.pipe(filter(t => t.symbol === 'AAPL'), map(t => t.price));
const filter$ = toObservable(this.statusFilter);       // 'all' | 'open'

// combineLatest: fires when ANY source emits, handing you everyone's latest
combineLatest([filter$, orders$]).pipe(map(([f, os]) => os.filter(o => f === 'all' || o.open)));
// ⚠ emits NOTHING until every source has emitted at least once:
combineLatest([filter$.pipe(startWith('all')), orders$]);                  // ✅ the fix

// withLatestFrom: only the SOURCE drives; the others just contribute their latest value
price$.pipe(withLatestFrom(draft$), map(([price, d]) => price * d.qty));   // re-estimate on each TICK,
                                                                          // not on each keystroke
// forkJoin: Promise.all. Waits for COMPLETION, so it needs cold, finite sources
forkJoin({ instruments: api.search(''), orders: api.orders() });           // emits once, both results
forkJoin({ price: price$ });                                              // ⚠ never emits: price$ is infinite

// merge: interleave by arrival. The classic "HTTP first, then live updates"
merge(api.orders().pipe(mergeMap(os => from(os))), events.on('order'));

// race: whoever emits first wins, the losers are unsubscribed
race(api.quote('AAPL'), timer(3000).pipe(map(() => null)));                // poor man's timeout

// startWith: give a stream an initial value (loading states, default filters)
api.search(q).pipe(map(r => ({ status: 'ok', r })), startWith({ status: 'loading' as const }));

// zip: pairs by INDEX, and buffers forever if one side is slower. You almost never want this
zip(price$, volume$);
```

The three to say out loud: **`combineLatest` is silent until every source has emitted**, **`forkJoin` needs
completion** (it emits nothing at all if a source completes empty, and an error in one cancels the rest), and
**`withLatestFrom` has a driver** while `combineLatest` does not.

## 8. Errors

```ts
// ❌ catchError on the OUTER stream: the first failed search kills the search box forever
query$.pipe(switchMap(q => api.search(q)), catchError(() => of([])));
// ✅ catch INSIDE the flattening operator: the outer stream survives
query$.pipe(switchMap(q => api.search(q).pipe(catchError(() => of([])))));
```
**An error terminates a stream permanently** — no more values, ever, and the teardown runs. That is the single most
important sentence in RxJS. For long-lived streams (route params, a Subject, a socket) always catch *inside* the inner
observable. NgRx's `tapResponse` does exactly this for you inside `rxMethod`.

```ts
api.search(q).pipe(catchError(() => EMPTY));                             // swallow and complete quietly
api.search(q).pipe(catchError(e => throwError(() => ApiError.from(e)))); // normalise and re-throw
api.search(q).pipe(catchError(e => (e.status === 404 ? of([]) : throwError(() => e))));  // recover selectively

api.place(draft).pipe(
  timeout({ each: 5000 }),                             // a hung request becomes an error you can handle
  finalize(() => this.submitting.set(false)),          // runs on success, error AND unsubscribe
);
```

- `finalize` is the place for "this request is over" bookkeeping: `loading.interceptor.ts` decrements its counter
  there, `dedup.interceptor.ts` removes its registry entry. Position matters — before `catchError` it fires when the
  *source* dies, after it fires when the *recovered* stream ends.
- An exception thrown inside `map`/`tap` becomes a stream error. It does not escape to the caller's try/catch.

### Retry with backoff: the real version
`retry({ count, delay })` with a function for `delay` is the whole feature. Returning `throwError` from it stops
retrying, which is how you retry *only* transient failures (`retry.interceptor.ts:26-35`):

```ts
next(req).pipe(
  retry({
    count: attempts,
    delay: (err, retryCount) => {
      if (!isTransient(err)) return throwError(() => err);       // 4xx: give up immediately
      const backoff = baseDelayMs * 2 ** (retryCount - 1);       // exponential
      return timer(backoff + Math.random() * backoff * 0.3);     // + jitter: no thundering herd
    },
  }),
);
```
`resetOnSuccess: true` is for long-lived streams, so the count restarts after a good run instead of accumulating over
hours. Honour `Retry-After` when the server sends it, and only retry what is safe to repeat: idempotent methods, or
writes carrying an `Idempotency-Key`.

## 9. Completion and lifetime

```ts
api.quote('AAPL').pipe(take(1));             // redundant: HttpClient completes after one value anyway
ticks$.pipe(take(1));                        // the NEXT tick, then unsubscribe from the socket
ticks$.pipe(first(t => t.price > 250));      // first match — ERRORS (EmptyError) if the source completes first
ticks$.pipe(takeWhile(t => t.price < 250));  // complete once it crosses; { inclusive: true } keeps that value
ticks$.pipe(takeUntil(this.stop$));          // complete when another stream emits
ticks$.pipe(takeUntilDestroyed());           // the Angular one: complete when the injector is destroyed
```
`take(1)` on an empty stream completes quietly; `first()` throws. Use `take(1)` unless "there must have been a value"
is genuinely an error worth reporting.

## 10. Hot vs cold, and sharing

```ts
const quote$ = api.quote('AAPL');
quote$.subscribe();                          // request #1
quote$.subscribe();                          // request #2 — COLD: one execution per subscriber

const shared$ = quote$.pipe(share());        // one execution while at least one subscriber is attached
shared$.subscribe(); shared$.subscribe();    // -> ONE request (this is the dedup interceptor)

const cached$ = quote$.pipe(shareReplay({ bufferSize: 1, refCount: false }));
cached$.subscribe();                         // the request fires
setTimeout(() => cached$.subscribe(), 5000); // no request: the last value is replayed (single-flight refresh)
```

- **Cold:** each subscriber gets its own execution (HttpClient: one request *per subscriber*). **Hot:** the producer
  exists independently (`ticks$`, DOM events, a `Subject`) and late subscribers miss whatever already happened.
- `share()` refcounts. The nuance worth saying out loud (`dedup.interceptor.ts`): *one caller unsubscribing doesn't
  cancel the request for the others; only when all of them unsubscribe is it cancelled.*
- `shareReplay({ refCount: false })` **keeps the source alive** after everyone leaves. Right for the single-flight
  refresh, a leak on an infinite source — use `refCount: true` for anything socket-shaped.

## 11. Subjects

```ts
const ticks  = new Subject<Tick>();                  // plain multicast: subscribers get FUTURE values only
const status = new BehaviorSubject<Status>('idle');  // has a current value: .getValue(), replays 1 to new subs
const recent = new ReplaySubject<Tick>(10);          // replays the last 10 (optionally within a windowTime)

readonly ticks$ = this.ticks.asObservable();         // expose the Observable, never the Subject (MarketSocket)
this.ticks.next(tick);                               // only the owner pushes
```

**A Subject that errors or completes is dead forever.** Later `next()` calls are ignored, and new subscribers get the
error/complete immediately:

```ts
this.ticks.error(new Error('socket dropped'));   // ❌ every consumer's stream is now permanently dead
this._status.set('reconnecting');                // ✅ failure goes on a separate channel (a status signal)
```
That's why `MarketSocket` models a dropped connection as a `status` signal rather than an error on `ticks$`: a Wi-Fi
blip must not permanently kill the price feed for every component in the app.

## 12. Subscription hygiene in Angular

```ts
// ✅ best: no subscription to manage at all
readonly results = toSignal(query$.pipe(switchMap(q => api.search(q))), { initialValue: [] });
load = rxMethod<void>(pipe(switchMap(() => api.orders())));   // NgRx cleans up with the store's injector

// ✅ when you really do need subscribe(): give it a lifetime
events.on('order').pipe(takeUntilDestroyed()).subscribe(o => this.toast(o));        // injection context
events.on('order').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(/* ... */);  // anywhere else

// ❌ a leak waiting to happen
events.on('order').subscribe(o => this.toast(o));
```
Order of preference: **`toSignal`** / `async` pipe / `rxMethod` → `takeUntilDestroyed()` → manual unsubscribe. HTTP
completes by itself, but you still want *cancellation* on destroy, which `takeUntilDestroyed` gives you for free.

## 13. Interop with signals

| API | Gotcha |
|---|---|
| `toSignal(obs$)` | typed `T \| undefined` until it emits: pass `{ initialValue }`, or `{ requireSync: true }` for a synchronous source |
| `toSignal` + errors | a source error is rethrown **when you read the signal**. Catch inside the pipe to get a value instead |
| `toObservable(sig)` | runs through an `effect`: emits **asynchronously**, latest value per tick only. Not a log of every `set()` |
| `firstValueFrom(obs$)` | rejects with `EmptyError` if the source completes without emitting. Use `{ defaultValue }` |
| `takeUntilDestroyed()` | needs an injection context (field initialiser/constructor) or an explicit `DestroyRef` |

```ts
// signal -> observable -> signal: the standard round trip for the search box
readonly results = toSignal(
  toObservable(this.query).pipe(switchMap(q => this.api.search(q))),
  { initialValue: [] },                                 // without this, the type is Instrument[] | undefined
);

// requireSync: the source emits synchronously, so there is never an undefined phase
readonly symbol = toSignal(route.paramMap.pipe(map(p => p.get('symbol')!)), { requireSync: true });

// toObservable is effect-backed, so it is ASYNC and coalesces within a tick
this.query.set('A'); this.query.set('AP');              // the stream sees only 'AP', on the next tick

// the escape hatch: the order form needs the outcome, so await it
const order = await firstValueFrom(this.api.place(draft));
```

## 14. Recipes

```ts
// Typeahead: debounce, drop duplicates, cancel the in-flight request, survive errors
readonly results = toSignal(
  toObservable(this.query).pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(q => (q.length < 2 ? of([]) : this.api.search(q).pipe(catchError(() => of([]))))),
  ), { initialValue: [] });

// Load on route param change (Angular REUSES the component on AAPL -> MSFT, so react to the stream)
readonly instrument = toSignal(route.paramMap.pipe(
  map(p => p.get('symbol')!),
  distinctUntilChanged(),
  switchMap(s => api.instrument(s)),
));

// Poll. timer(0, 1000) fires on a clock (lab-page.ts); repeat({delay}) waits for the response first
toSignal(timer(0, 1000).pipe(switchMap(() => api.stats())), { initialValue: null });
defer(() => api.stats()).pipe(repeat({ delay: 1000 }));           // no overlap, no starvation

// Parallel vs sequential-dependent
forkJoin({ orders: api.orders(), positions: api.positions() });    // Promise.all
api.order(id).pipe(switchMap(o => api.quote(o.symbol)));           // await, then await

// Submit once: ignore double-clicks while the request is running
submit = rxMethod<Draft>(pipe(exhaustMap(d => api.place(d).pipe(tapResponse({ /* ... */ })))));

// Fire-and-forget with cleanup, outside a store (portfolio.store.ts)
events.on('order').pipe(filter(o => o.status === 'FILLED'), debounceTime(250), takeUntilDestroyed())
  .subscribe(() => this.load());

// Single-flight: everyone who asks during the request shares it (auth.service.ts)
this.inFlight$ = this.http.post<AuthResponse>(url, body).pipe(
  finalize(() => (this.inFlight$ = null)),
  shareReplay({ bufferSize: 1, refCount: false }),
);
```

## 15. Debugging

- **"My request fires twice."** The observable is cold and you subscribed twice — usually two `async` pipes over the
  same `obs$`, or a `subscribe()` alongside a template binding. Share it, or convert once with `toSignal`.
- **"Nothing happens."** You built a pipeline and never subscribed (no `async` / `toSignal` / `subscribe`), or a
  `combineLatest` source hasn't emitted yet (§7).
- **"It worked once, then stopped."** Something errored and killed the stream (§8).
- Trace with the observer form of `tap`, which shows the lifecycle and not just the values:

```ts
api.search(q).pipe(
  tap({
    subscribe:   () => console.log('[search] subscribe'),    // did it even start?
    next:        v => console.log('[search] next', v),
    error:       e => console.log('[search] error', e),
    unsubscribe: () => console.log('[search] cancelled'),    // proves switchMap cancelled the previous one
    finalize:    () => console.log('[search] done'),
  }),
);
```

- `groupBy` + `mergeMap` gives one stream per key (per-symbol throttling, say), but groups never complete on their own
  — pass a duration selector, or you leak an inner subscription per key ever seen:

```ts
ticks$.pipe(
  groupBy(t => t.symbol, { duration: g => g.pipe(debounceTime(30_000)) }),   // close idle groups
  mergeMap(group$ => group$.pipe(auditTime(100))),                           // throttle PER symbol
);
```
