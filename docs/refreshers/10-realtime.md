# Realtime refresher: WebSocket and SSE in Angular

Repo references: `core/realtime/market-socket.service.ts`, `event-stream.service.ts`, `track-symbols.ts`,
`state/quotes.store.ts`, `server/index.mjs`.

## WebSocket vs SSE

| | WebSocket | Server-Sent Events |
|---|---|---|
| Direction | both ways | server → client |
| Protocol | own protocol after an HTTP upgrade | plain HTTP (`text/event-stream`) |
| Reconnect | **you build it** | built in (`retry:` field) |
| Resume after a drop | you build it | built in: `id:` + `Last-Event-ID` |
| Custom headers (auth) | no (query param, cookie, or first message) | no (query param or cookie) |
| Use here | prices (client changes subscriptions) | order and news events |

## Architecture: one connection → one store → many signals
```
WebSocket ─▶ MarketSocket.ticks$ ─▶ bufferTime(100) ─▶ QuotesStore.patchState ─▶ quotes() signal
                                                                         ├─▶ ticker tape
   components call trackSymbols(() => [...])  ──▶ ref-counted retain      ├─▶ watchlist row + sparkline
   (interest, not subscriptions)                                          ├─▶ detail header / chart / ticket
                                                                          └─▶ portfolio P&L (computed)
```
Components **never touch the socket**. They read signals and declare interest. That gives you one connection, one
merge point, and consistent views.

## Checklist for a production socket client (all implemented)
1. **Single shared connection** per app (a root service), lazily opened on first interest and closed after idle.
2. **Ref-counted subscriptions:** 4 components watching AAPL → 1 server subscription.
3. **Batched diffs:** subscribe/unsubscribe changes coalesced per microtask (desired vs sent).
4. **Reconnect with exponential backoff + jitter**, then **re-subscribe** to whatever is wanted now.
5. **Auth:** the token goes in the URL at connect time. On close code 4401, refresh through the *same* single-flight
   refresh as HTTP, then reconnect.
6. **Heartbeat:** ping on an interval. If nothing has arrived for N seconds, force-close (detects half-open sockets after
   sleep or a Wi-Fi switch).
7. **`online` event** → reconnect immediately instead of waiting out the backoff.
8. **Follow auth:** disconnect on logout (an `effect` on `isAuthenticated`).
9. **Batch UI updates** (`bufferTime`), drop out-of-order ticks by timestamp, and keep structural sharing.
10. **Expose status as a signal** for the UI (the header badges).

## SSE specifics
- Wrap `EventSource` in `new Observable(...)` (teardown = `es.close()`), then `share()` so there's one connection.
- `readyState === CONNECTING` on error → the browser is retrying by itself. `CLOSED` → it gave up (e.g. 401), so you
  take over: refresh if it never opened, back off, and reconnect passing `lastEventId`.
- Gate on auth: `toObservable(isAuthenticated).pipe(switchMap(ok => ok ? raw$ : EMPTY))`.

## Reconciling realtime with HTTP
Events can arrive *before* the HTTP response that created the entity. Upsert by id and keep the version with the
greater `updatedAt` (`OrdersStore.upsertIfNewer`). Then arrival order doesn't matter.

## RxJS's built-in option
`webSocket()` from `rxjs/webSocket` gives a `WebSocketSubject` with `.multiplex(sub, unsub, filter)`. It's fine for
simpler cases. I hand-rolled the client because the URL (token) changes between reconnects and I wanted explicit
ref-counting, heartbeat and status.

## Zone apps
With zone.js, every socket message triggers app-wide change detection. Use `ngZone.runOutsideAngular` for the socket and
re-enter (throttled) to update state. Zoneless + signals makes this unnecessary.
