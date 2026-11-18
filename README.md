# Market Desk: an Angular 21 reference app

A small live trading desk built to show **senior-level Angular**: signal stores (NgRx SignalStore and hand-rolled), a
deliberate interceptor chain (dedup, loading, errors, idempotency, auth refresh, retry), one multiplexed WebSocket
feeding many components, SSE with resume, hierarchical DI as "context", typed reactive forms, lazy routes and guards.

Angular **21** (current major is 22), zoneless, standalone, signals-first, Vitest.

## Run it

```bash
npm install
npm start          # mock API on :3000 + Angular dev server on :4200 (proxied)
```

Open http://localhost:4200 and sign in with `demo` / `demo`. Then go to **Lab** with DevTools › Network open.

```bash
npm test           # 20 unit tests: dedup, single-flight refresh, retry/idempotency, store races
npm run build      # production build
```

## Where to start reading

👉 **[docs/INTERVIEW_NOTES.md](docs/INTERVIEW_NOTES.md)** has the guided tour, the React/Vue → Angular map, talking points,
likely questions, and a 4-day plan.
👉 **[docs/refreshers/](docs/refreshers/README.md)** has one refresher per topic: HttpClient, signals, RxJS, DI,
components, change detection, routing, forms, state, realtime, testing.

```
server/index.mjs                     mock backend (REST + SSE + WS + debug endpoints)
src/app/app.config.ts                the whole app's wiring in one list. Start here
src/app/app.routes.ts                lazy routes + canMatch guards
src/app/core/http/interceptors/      the six interceptors (read index.ts first: the ORDER is the point)
src/app/core/auth/                   signal-based auth service, single-flight refresh, functional guards
src/app/core/realtime/               one WebSocket (ref-counted subscriptions), SSE stream, trackSymbols()
src/app/state/                       NgRx SignalStores: quotes, orders, portfolio, news
src/app/features/markets/instrument-detail/
                                     component-scoped store = Angular's "React Context"
src/app/features/lab/                interactive proof of dedup / retry / refresh / reconnect
```
