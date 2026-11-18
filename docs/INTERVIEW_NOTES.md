# Interview notes: Angular for a React/Vue senior

You already know the hard part: state, effects, rendering, data flow, and network failure modes. Angular is the
same problems with different nouns, plus two things React doesn't really have: **a real DI container** and
**RxJS as a first-class citizen**. Lead with the architecture thinking and be honest about the syntax.

---

## 1. The translation table

| You know (React / Vue) | Angular 21 | Where in this repo |
|---|---|---|
| `useState` / `ref()` | `signal()` | everywhere |
| `useMemo` / `computed()` | `computed()` (lazy, memoised, auto-tracked deps) | `portfolio.store.ts` |
| `useEffect` / `watchEffect` | `effect()` (auto-tracked, `onCleanup`) | `track-symbols.ts` |
| Derived state that can also be overridden | `linkedSignal()` | `watchlist-page.ts` (`activeIndex`) |
| `createContext` + Provider + `useContext` | **Hierarchical DI**: `providers: [X]` on a component + `inject(X)` in children | `instrument-detail.store.ts` ⭐ |
| Custom hook | "Injection-context function": a function calling `inject()`/`effect()` during construction | `trackSymbols()`, `onSessionChange()` |
| Props | `input()` / `input.required()` | `sparkline.ts` |
| Emitting events / callbacks | `output()` | n/a |
| `v-model` / `defineModel` | `model()` + `[(x)]` banana-in-a-box | `news-panel.ts` |
| Redux / Zustand / Pinia | NgRx SignalStore (or classic NgRx Store) | `src/app/state/` |
| TanStack Query `useQuery` | `httpResource()` (experimental) / `resource()` | `instrument-detail.store.ts` |
| axios interceptors | `HttpInterceptorFn` chain + `HttpContextToken` | `core/http/` |
| react-router loaders/guards | functional `CanMatchFn` / `CanDeactivateFn` / `ResolveFn` | `auth.guards.ts`, `markets.routes.ts` |
| `React.lazy` / dynamic import | `loadComponent` / `loadChildren` / `@defer` blocks | `app.routes.ts`, detail page |
| `{cond && …}` / `v-if`, `.map` / `v-for` | `@if`, `@for (…; track id)`, `@switch`, `@let` | templates |
| custom directive (Vue) / hook + ref | `@Directive` with `host` bindings | `price-flash.directive.ts` |
| filters / formatting helpers | Pipes (pure by default = memoised) | `signed.pipe.ts` |
| React.memo / `shouldComponentUpdate` | `ChangeDetectionStrategy.OnPush` (+ signals) | every component |
| Error boundary | `ErrorHandler` (global) | `global-error-handler.ts` |
| React Hook Form / VeeValidate | Reactive Forms (typed); Signal Forms are experimental in 21 | `order-ticket.ts` |

---

## 2. A guided tour (read in this order, ~2 hours)

1. **`app.config.ts`**: the root injector. Every global concern is one line. Say: *"I can read the architecture
   off this file."*
2. **`core/http/interceptors/index.ts`**: **the order of interceptors is a design decision.** Learn this onion:
   - `dedup` outermost → duplicate callers share *everything* below (one spinner, one toast, one refresh)
   - `loading` → counts one logical request no matter how many retries
   - `error` → sees the *final* outcome, normalises to `ApiError`, toasts once (skips 401/422/silent)
   - `idempotency` → stamps the key *before* retry/auth so replays reuse the same key
   - `auth` → bearer + 401 → single-flight refresh → replay
   - `retry` innermost → each attempt is a real network call
3. **`dedup.interceptor.ts`**: `share()` plus a registry. Know the nuance: *one caller unsubscribing doesn't cancel the
   request for the others; only when all unsubscribe is the request cancelled.* It's **not a cache**.
4. **`auth.interceptor.ts` + `auth.service.ts`**: the refresh-storm problem and its three-part fix (wait if a refresh is
   in flight; if the token already rotated, just retry; else join the single shared refresh). The tests in
   `auth.interceptor.spec.ts` read like a spec. Read them.
5. **`market-socket.service.ts`**: one socket, **ref-counted** symbol interest, **microtask-batched diff** of
   desired vs sent subscriptions, lazy connect / idle close, backoff with jitter, 4401 → refresh → reconnect,
   heartbeat for half-open connections.
6. **`event-stream.service.ts`**: SSE as a typed, shared Observable that follows auth via `toObservable(isAuthenticated)`
   + `switchMap`. Last-Event-ID resume.
7. **`state/quotes.store.ts`**: ticks → `bufferTime(100)` → one `patchState` per batch. **Structural sharing** means
   unchanged quotes keep their reference, so signal equality stops re-renders for symbols that didn't tick.
8. **`state/orders.store.ts`**: three racing sources (GET, POST response, SSE). `upsertIfNewer` by `updatedAt`.
   Optimistic add + rollback.
9. **`state/portfolio.store.ts`**: P&L is **derived**, never stored. Cross-store composition (`inject(QuotesStore)`
   inside `withComputed`).
10. **`features/markets/instrument-detail/`** ⭐ the **context** story. The page has `providers: [InstrumentDetailStore]`;
    header, chart, ticket and activity all `inject()` it with zero inputs. It's also a **facade** over four root stores.
    Note `symbol` comes from `paramMap` *as a signal*, because Angular reuses the component on AAPL → MSFT.
11. **`order-ticket.ts`**: typed reactive forms, conditional control (enable/disable), cross-field validator reading a
    signal, server 422 → `setErrors` on fields, `form.events` → dirty flag → `canDeactivate` guard.

**"Same tick, six consumers":** one WebSocket message updates the ticker tape, watchlist row and sparkline, detail
header, chart tail, the order ticket's estimate, and portfolio P&L. No component knows a socket exists. They read
signals and declare interest via `trackSymbols()`.

---

## 3. Concepts you must be able to explain out loud

### Change detection (the #1 Angular interview topic)
- **Old world (zone.js):** zone.js monkey-patches every async API (setTimeout, Promise, XHR, events). After *any* async
  task, Angular checks the component tree top-down. `OnPush` limits checking a component to when its inputs change
  by reference, an event fires inside it, the `async` pipe emits, or it's marked dirty.
- **New world (zoneless, default in v21):** no zone.js. Change detection is *scheduled* by signal writes that a template
  reads, template event handlers, `async` pipe, `markForCheck()`. That's why everything here is signals + OnPush.
- **Gotcha I hit and fixed:** Reactive Forms aren't signals. In zoneless, bind the template to
  `toSignal(form.statusChanges)` instead of reading `form.invalid` directly if validity can change without a DOM event.
- If asked about high-frequency data in a zone app: `ngZone.runOutsideAngular()` for the socket, then re-enter
  (or throttle) when updating the UI. Zoneless removes this concern, and batching (`bufferTime`) still matters.

### Signals vs RxJS: when to use which
- **Signals:** *state* (a value that exists now). Synchronous, glitch-free, auto-tracked. Templates, computed
  values, store state.
- **RxJS:** *events over time* and async orchestration: sockets, debounce, retry, cancellation (`switchMap`),
  racing, batching. Interceptors are RxJS by nature.
- **Bridges:** `toSignal(obs$)` (auto-unsubscribes with the injector), `toObservable(signal)`, NgRx `rxMethod`.
- **Flattening operators** (you WILL be asked): `switchMap` cancels previous (search/typeahead, `load()`),
  `mergeMap` runs all in parallel (`cancel(id)` for different orders), `concatMap` queues (ordered writes),
  `exhaustMap` ignores new ones while busy (`loadInstruments`, submit buttons).

### Dependency injection
- `providedIn: 'root'` → app singleton, tree-shakable. Component `providers: []` → one instance per component subtree
  (the "context"). Route `providers` → instance per lazy route's environment injector.
- `inject()` only works in an *injection context*: field initialisers, constructor, factory functions, guards,
  interceptors, store hooks. That's why `trackSymbols()` must be called at construction time.
- `InjectionToken` for non-class values (`APP_CONFIG`). Resolution modifiers: `{ optional, self, skipSelf, host }`.
- Why DI beats imports: swap per test (`TestBed` providers), per environment, or per subtree, without touching consumers.

### Lifecycle and cleanup
- `DestroyRef.onDestroy`, `takeUntilDestroyed()`, `effect` cleanup, and `toSignal` all tie teardown to the owning
  injector. A senior answer to *"how do you prevent memory leaks?"*: **"Subscriptions are owned by an injector. I don't
  subscribe manually without `takeUntilDestroyed`, and I prefer `toSignal` / `async` pipe / `rxMethod`, which clean up
  for me."**
- `ngOnInit`, `ngOnChanges` and `ngOnDestroy` still exist. Signal inputs + `computed`/`effect` replace most of
  `ngOnChanges`.

### State management: what goes where (say this, it's a senior signal)
- **URL:** what you're looking at (orders `?filter=`, `:symbol`). Shareable, back button works.
- **Component signals:** ephemeral UI state (search box, sort, a panel's open flag).
- **Component-scoped store:** a feature's shared state across a subtree (detail page).
- **Root store:** cross-cutting domain state (quotes, orders, portfolio).
- **Server cache** (`httpResource`/query libs): data that's just a projection of the server.
- **Derived (computed):** never store what you can compute (P&L).

### NgRx: classic vs SignalStore
- **Classic NgRx Store** = Redux: actions → reducers (pure) → selectors (memoised) → effects (side effects, RxJS).
  Great DevTools and time travel, very explicit, lots of boilerplate. Common in large enterprises, so expect it in the codebase.
- **SignalStore** (used here) = composable features: `withState`, `withComputed`, `withMethods`, `withHooks`,
  `withEntities`, `withProps`, `rxMethod`. State is protected (only `patchState` inside the store can mutate),
  `_`-prefixed members are private. Less ceremony; lives naturally at root *or* component level.
- Honest line: *"My production experience is with Redux/Zustand/Pinia. The model maps 1:1 to classic NgRx. I built this
  with SignalStore because that's where new Angular code is heading."*

---

## 4. Likely questions with short answers

**Q: How does an HTTP interceptor work in modern Angular?**
A functional `HttpInterceptorFn (req, next) => Observable<HttpEvent>`, registered with
`provideHttpClient(withInterceptors([...]))`. Requests are immutable: `req.clone({ setHeaders })`. The array order
is outer to inner. Per-request options use `HttpContextToken`s, not URL sniffing.

**Q: How would you deduplicate requests?**
Registry keyed by method + URL with params + responseType; store the `share()`d observable; remove on `finalize`. Only GETs, with an
opt-out token. It's distinct from caching: caching is a store's or query layer's job, with an invalidation policy.

**Q: Token refresh with many concurrent requests?**
Single-flight: one shared refresh observable (`shareReplay`), new requests wait on it, and a 401 for an already-rotated
token retries without refreshing. Logout only on a *definitive* refresh failure (401/400), never on a network blip.
(Point at the spec file.)

**Q: WebSocket vs SSE?**
SSE: one-way, plain HTTP, auto-reconnect + Last-Event-ID built in, proxy-friendly, but no custom headers (token goes in
the query string or a cookie). WebSocket: bidirectional, needed when the client changes subscriptions; you build
reconnect, heartbeats and resubscribe yourself.

**Q: How do multiple components stay in sync with realtime data?**
One connection service → one store → many signal readers. Components declare interest (ref-counted) and never touch the
socket. Batch updates; keep structural sharing so unaffected views don't re-render.

**Q: Why is `inject()` preferred over constructor injection?**
Works in functions (guards, interceptors, stores), plays well with inheritance and field initialisers, and enables
composable "injection-context functions". Constructor injection still works.

**Q: `ActivatedRoute.snapshot` vs `paramMap`?**
Snapshot is read once. When only params change, Angular **reuses the component**, so use `paramMap` (or
`withComponentInputBinding()` + `input()`), as the detail store does.

**Q: How do you lazy load?**
`loadComponent`/`loadChildren` per route (each is a chunk), `canMatch` to avoid even downloading unauthorised
chunks, `@defer (on idle | viewport | interaction)` for parts of a template, plus a preloading strategy.

**Q: Standalone vs NgModules?**
Standalone is the default since v17 (v19 made it implicit). Components declare their own `imports`. NgModules still
exist in older codebases. I can read them; the concepts (declarations/imports/providers) map directly.

**Q: Testing?**
TestBed configures an injector per test. `HttpTestingController` (`expectOne`, `flush`, `verify`) for HTTP. v21's default
runner is Vitest (older projects: Karma/Jasmine or Jest). Store tests use real stores with a mocked HTTP backend.

**Q: Performance checklist?**
OnPush + signals, `track` in `@for`, pure pipes rather than template method calls for expensive work, `@defer`, lazy routes,
batching high-frequency streams, `computed` with custom `equal`, virtual scrolling (CDK) for big lists, bundle budgets.

---

## 5. Gotchas worth mentioning (each one signals experience)
- `effect()` that sets signals to mirror other signals is a smell. Use `computed` or `linkedSignal`.
- Read the trigger signal *outside* `untracked()` and do the work *inside* it, or the effect tracks things it shouldn't.
- `httpResource.value()` throws in the error state, so check `hasValue()` / `error()` first.
- Reactive Forms: disabled controls are excluded from `.value` (use `getRawValue()`), and validators don't re-run
  when an external signal changes (call `updateValueAndValidity()`).
- Indexing a `Record<string, T>` returns `T`, not `T | undefined`. Be explicit (see the detail store).
- Route environment injectors aren't destroyed when you navigate away. Be careful with heavy route-level providers.
- Literal `{` / `}` in templates must be escaped since the new control-flow syntax.

---

## 6. Four-day plan

**Day 1: run it, break it.** `npm start`, use every page, run the Lab with DevTools open. Read sections 2.1–2.4 and the
interceptor specs. Change the interceptor order, re-run `npm test`, and explain *why* tests fail.

**Day 2: state and realtime.** Read 2.5–2.9. Exercise: add a "Watchlist favourites" root SignalStore persisted to
localStorage (use an `effect`), and show a ★ in the watchlist and ticker. Then add a `withEntities` collection.

**Day 3: components, forms, routing.** Read 2.10–2.11. Exercise: add a "Price alerts" page with a reactive form
(symbol, above/below, price), a component-scoped store, and a toast when a live tick crosses the threshold. Add a
`canDeactivate` on it. Write one TestBed spec.

**Day 4: interview polish.** Re-read section 3 and say the answers out loud. Skim the classic NgRx docs (actions,
reducers, effects, selectors) so you can map them to Redux. Skim NgModules so legacy code doesn't surprise you. Be able to whiteboard the
interceptor onion and the "one socket → store → many signals" diagram from memory.

---

## 7. How to frame it in the room
> "My production depth is React and Vue. Before this interview I built an Angular 21 app to make sure I understand how
> Angular solves the problems I already solve elsewhere: signal stores, an interceptor chain with dedup and
> single-flight token refresh, a multiplexed WebSocket feeding many components, SSE with resume, and hierarchical DI
> instead of React Context. I'm comfortable with the architecture; I'd still be looking up some API details."

That's honest, specific, and senior. Then let them pull on any thread: every claim maps to a file you can open.
