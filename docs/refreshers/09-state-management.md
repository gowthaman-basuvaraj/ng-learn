# State management refresher: services, SignalStore, classic NgRx

Repo references: `core/auth/auth.service.ts` (hand-rolled), `state/*.store.ts` (SignalStore),
`instrument-detail.store.ts` (component-scoped SignalStore).

## Decide where state lives first
URL → component signal → component-scoped store → root store → server cache, and **derive** everything else with
`computed`. (Details are in INTERVIEW_NOTES §3.)

## Level 1: a service with signals (no library)
```ts
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<Session | null>(null);       // private writable
  readonly user = computed(() => this.session()?.user ?? null);  // public read-only projections
  login(...) { ... this.session.set(s) }                         // methods are the only writers
}
```
Enough for small, cohesive state. It's the Angular version of a Zustand store.

## Level 2: NgRx SignalStore
```ts
export const QuotesStore = signalStore(
  { providedIn: 'root' },                 // omit → provide it in a component's providers (scoped store)
  withEntities(instrumentConfig),          // normalised collection: ids + entityMap + entities()
  withState({ quotes: {}, status: 'idle' }),
  withProps(() => ({ _api: inject(MarketApi) })),          // `_` = private to the store
  withComputed(({ quotes }) => ({ count: computed(() => Object.keys(quotes()).length) })),
  withMethods((store) => ({
    applyTicks(ticks: Tick[]) { patchState(store, s => ({ quotes: { ...s.quotes, ... } })); },
    load: rxMethod<void>(pipe(
      exhaustMap(() => store._api.instruments().pipe(
        tapResponse({ next: list => patchState(store, setAllEntities(list, cfg)), error: console.error }),
      )),
    )),
  })),
  withHooks({ onInit(store) { /* subscriptions, effects */ }, onDestroy(store) {} }),
);
```
- **State is protected:** only `patchState` *inside* the store can write (opt out with `protectedState: false`).
- Each top-level state key becomes a signal (`store.quotes()`), and nested objects become "deep signals".
- `rxMethod` takes a value, a signal or an observable and handles subscription cleanup. `signalMethod` is the non-RxJS version.
- Entity updaters: `setAllEntities`, `setEntity`, `addEntity`, `updateEntity({ id, changes })`, `upsertEntity`,
  `removeEntity`, `removeAllEntities`. Named collections via `entityConfig({ collection: 'order' })` →
  `orderEntities()`, `orderEntityMap()`.
- Reusable features: `signalStoreFeature(...)` (I tried one with a typed input contract and hit generic-inference
  friction, see `with-session-lifecycle.ts`. A good honest anecdote.)
- Testing: inject the store with a mocked HTTP backend (`orders.store.spec.ts`), or `unprotected(store)` from
  `@ngrx/signals/testing` to set state directly.

## Level 3: classic NgRx Store (= Redux, very common in enterprises)
```ts
// actions
export const OrdersPage = createActionGroup({ source: 'Orders Page', events: { 'Opened': emptyProps(), 'Cancel': props<{ id: string }>() } });
// reducer (pure)
export const ordersFeature = createFeature({
  name: 'orders',
  reducer: createReducer(initial, on(OrdersApi.loaded, (s, { orders }) => adapter.setAll(orders, { ...s, loading: false }))),
});
// selector (memoised)
export const selectOpen = createSelector(ordersFeature.selectAll, os => os.filter(o => o.status === 'WORKING'));
// effect (side effects)
load$ = createEffect(() => inject(Actions).pipe(ofType(OrdersPage.opened),
  switchMap(() => inject(TradingApi).orders().pipe(map(orders => OrdersApi.loaded({ orders })), catchError(e => of(OrdersApi.failed({ e })))))));
// component
orders = this.store.selectSignal(selectOpen);   this.store.dispatch(OrdersPage.opened());
```
Redux mapping: actions = actions, reducers = reducers, selectors = reselect, **effects = redux-observable/sagas**,
`@ngrx/entity` = RTK `createEntityAdapter`, Store DevTools = Redux DevTools.

## Which one when (say this)
- Small or local state → signals in a service or component.
- Feature or domain state with async → **SignalStore** (less ceremony, can be scoped to a component).
- Large team, strict event log, heavy cross-feature orchestration, time-travel debugging → **classic NgRx**.
- Never store derived data: P&L here is a `computed` joining two stores.
