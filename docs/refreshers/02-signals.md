# Signals refresher

> Mental model: **a signal is a value plus a list of who read it.** Reading inside a reactive context (`computed`, `effect`,
> a template) records a dependency, and writing notifies the dependants. There are no dependency arrays.

Repo references: every component, `state/*.store.ts`, `core/realtime/track-symbols.ts`.

## The primitives

```ts
const count = signal(0);                 // WritableSignal<number>
count();                                 // read
count.set(5); count.update(n => n + 1);  // write
const ro = count.asReadonly();           // expose read-only (pattern: private writable, public readonly)

const double = computed(() => count() * 2);       // lazy + memoised; recomputes only when a dependency changed AND someone reads it
const list = computed(() => rows().map(r => r.symbol).sort(), {
  equal: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),   // custom equality stops downstream churn
});

effect((onCleanup) => {                  // side effects: DOM, storage, logging, bridging to non-signal APIs
  const release = socket.retain(symbols());
  onCleanup(release);                    // runs before the next run AND on destroy
});

untracked(() => store.reset());          // read/write without creating a dependency
```

## Newer APIs

| API | Use it when | Repo example |
|---|---|---|
| `linkedSignal({ source, computation })` | derived state that the user can override, resetting when the source changes | `watchlist-page.ts` `activeIndex` |
| `input()` / `input.required()` | component props as signals | `sparkline.ts` |
| `model()` | two-way binding `[(x)]` | `news-panel.ts` |
| `output()` | events (not a signal, it emits) | n/a |
| `viewChild()` / `viewChildren()` / `contentChild()` | element/component refs as signals | n/a |
| `resource` / `httpResource` | async data as signals (experimental) | `instrument-detail.store.ts` |
| `toSignal(obs$, { initialValue })` | Observable → Signal, auto-unsubscribes | `lab-page.ts`, `order-ticket.ts` |
| `toObservable(sig)` | Signal → Observable | `event-stream.service.ts` |
| `afterRenderEffect` | effects that must touch DOM after rendering | n/a |

## Rules that separate juniors from seniors

1. **`computed` for derivations, never `effect` + `set`.** An effect that writes a signal to mirror another is the
   #1 anti-pattern (extra render, possible glitches/loops). If it's "derived but overridable", use `linkedSignal`.
2. **Effects are for leaving the signal world**: DOM, storage, sockets, logging. In this repo:
   `AuthService` persisting to sessionStorage, `trackSymbols` managing socket interest, `PriceFlash` animating.
3. **Read the trigger, `untracked` the work.** `effect(() => { const authed = auth.isAuthenticated(); untracked(() => authed ? start() : end()); })`.
   Otherwise every signal read inside `start()` becomes a trigger too.
4. **Equality is reference by default (`Object.is`).** Updating with a new object that has the same content still notifies.
   So use structural sharing in stores: keep unchanged objects' references (see `QuotesStore.applyTicks`).
5. **Signals are synchronous and glitch-free.** A `computed` never sees a half-updated state. Effects run later, batched,
   during change detection.
6. **Injection context:** `effect`, `toSignal`, `input` must be created in a constructor/field initialiser (or pass
   `{ injector }`). Their lifetime is tied to that injector.
7. **`computed` is lazy**: nobody reads it, it never runs. `effect` is eager (scheduled).

## Signals vs React state

| React | Angular signals |
|---|---|
| Component re-runs top to bottom on any state change | Only the template bindings / computeds that read the changed signal update |
| `useMemo(fn, [deps])` | `computed(fn)`, deps auto-tracked |
| `useEffect(fn, [deps])` | `effect(fn)`, deps auto-tracked, cleanup via `onCleanup` |
| Stale closures | Not a thing: you read the current value at call time |
| Context re-renders every consumer | DI gives the instance; each consumer re-renders only for signals *it* reads |

## Signals vs RxJS (one-liner)
**Signals hold *state* (what is true now). Observables model *events over time*** (debounce, retry, cancellation, sockets).
Convert at the boundary with `toSignal`/`toObservable`.
