# RxJS refresher (the subset Angular devs actually use)

> Mental model: **an Observable is a function that, when subscribed, starts producing values over time and returns a
> teardown.** Cold by default, lazy, cancellable.

Repo references: `core/http/interceptors/*`, `core/realtime/*`, `state/*.store.ts` (`rxMethod`).

## Creation
`of(1,2)`, `from(promiseOrArray)`, `timer(0, 1000)`, `interval(1000)`, `fromEvent(el, 'click')`, `defer(() => ...)`
(build lazily at subscribe time; see `loading.interceptor.ts`), `throwError(() => err)`, `EMPTY`, `NEVER`,
`new Observable(subscriber => { ...; return teardown })` (see `event-stream.service.ts`).

## Operators you must know cold

| Group | Operators | Notes |
|---|---|---|
| Transform | `map`, `filter`, `tap`, `scan` | `scan` = reducer over time |
| Flatten | `switchMap`, `mergeMap`, `concatMap`, `exhaustMap` | **know the four by heart** (table below) |
| Rate | `debounceTime`, `throttleTime`, `auditTime`, `bufferTime`, `distinctUntilChanged` | `bufferTime(100)` batches ticks in `QuotesStore` |
| Combine | `combineLatest`, `forkJoin`, `merge`, `withLatestFrom`, `zip` | `forkJoin` = `Promise.all` (waits for completion) |
| Errors | `catchError`, `retry({count, delay})`, `finalize` | `catchError` must return an Observable |
| Lifetime | `take(1)`, `takeUntil`, `takeUntilDestroyed()`, `first` | |
| Multicast | `share()`, `shareReplay({bufferSize:1, refCount})` | dedup interceptor, single-flight refresh |

### The four flattening operators

```
switchMap  → cancel the previous inner      (typeahead, "load for current route param")
mergeMap   → run all concurrently          (independent actions)
concatMap  → queue, one at a time in order (ordered writes)
exhaustMap → ignore new while one runs     (submit button, "load once")
```

## Hot vs cold, and sharing
- **Cold:** each subscriber gets its own execution (HttpClient: one request each).
- **Hot:** the producer exists independently (WebSocket messages, DOM events, a `Subject`).
- `share()` turns cold into shared-while-subscribed (refcounted; resets when everyone leaves).
- `shareReplay({ bufferSize: 1, refCount: false })` also replays the last value to late subscribers and **keeps the
  source alive**. That's right for the single-flight refresh, and a leak risk for infinite streams (use `refCount: true` there).

## Subjects
`Subject` (plain multicast), `BehaviorSubject` (has a current value; largely replaced by `signal` for state),
`ReplaySubject(n)`. Expose `subject.asObservable()`, never the Subject itself (see `MarketSocket.ticks$`).

## Subscription hygiene in Angular
Prefer, in order: **`toSignal`** / `async` pipe / NgRx `rxMethod` (automatic cleanup) → `takeUntilDestroyed()`
in an injection context → `takeUntilDestroyed(this.destroyRef)` elsewhere. Manual `subscribe()` with no lifetime
is a leak waiting to happen. HTTP completes by itself, but you still want cancellation on destroy.

## Error-handling placement matters
```ts
// ❌ catchError on the OUTER stream: the first error kills the whole search box forever
query$.pipe(switchMap(q => api.search(q)), catchError(() => of([])));
// ✅ catch INSIDE the flattening operator: the outer stream survives
query$.pipe(switchMap(q => api.search(q).pipe(catchError(() => of([])))));
```
NgRx's `tapResponse` does exactly this for you inside `rxMethod`.

## Interop
`firstValueFrom(obs$)` / `lastValueFrom` → Promise. `toSignal` / `toObservable` ↔ signals.
`rxMethod<T>(pipe(...))` (NgRx) → a method that accepts a value, a signal or an observable.
