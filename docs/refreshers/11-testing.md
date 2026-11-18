# Testing refresher

Repo references: `core/http/interceptors/*.spec.ts`, `state/orders.store.spec.ts`. Run with `npm test`.

## Runners
v21 default: **Vitest** via `ng test` (`@angular/build:unit-test`). Older projects use **Karma + Jasmine** (the old
default) or Jest. The APIs are near-identical: `describe/it/expect`, `vi.fn()` ≈ `jasmine.createSpy()`, `vi.useFakeTimers()` ≈
`fakeAsync/tick`.

## TestBed = a configurable injector
```ts
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),                       // after provideHttpClient
      provideRouter([]),
      { provide: MarketApi, useValue: { instruments: () => of([]) } },   // fake a dependency
    ],
  });
});
const svc = TestBed.inject(AuthService);
```

## Component tests
```ts
await TestBed.configureTestingModule({ imports: [Sparkline] }).compileComponents();
const fixture = TestBed.createComponent(Sparkline);
fixture.componentRef.setInput('points', [1, 2, 3]);   // signal inputs
await fixture.whenStable();                            // zoneless: wait for scheduled CD (or fixture.detectChanges())
expect(fixture.nativeElement.querySelector('path')).toBeTruthy();
```
- Query the DOM like a user would (text, roles). Angular Testing Library (`@testing-library/angular`) is popular.
- `TestBed.tick()` flushes effects. `TestBed.runInInjectionContext(() => ...)` tests injection-context functions.

## HTTP tests
See 01-http-client.md §8: `expectOne`, `flush`, `expectNone`, `match`, `verify`.

## Testing RxJS

Three techniques cover almost everything. Reach for them in this order.

### 1. Fake timers + `HttpTestingController` (the default here)

Anything time-based — debounce, backoff, polling, buffering — needs control over the clock. This project has **no
zone.js dependency**, so the zone-based `fakeAsync` / `tick()` helpers are not available: use Vitest's fake timers,
which is what every spec in the repo does (`retry.interceptor.spec.ts`).

```ts
beforeEach(() => {
  vi.useFakeTimers();
  TestBed.configureTestingModule({ providers: [ /* ... */ provideHttpClientTesting()] });
});
afterEach(() => {
  backend.verify();        // nothing outstanding
  vi.useRealTimers();      // or the next file inherits a frozen clock
});

it('retries with backoff and surfaces only the final success', async () => {
  let result: unknown;
  http.get('/api/x').subscribe(r => (result = r));

  backend.expectOne('/api/x').flush(null, { status: 503, statusText: 'Unavailable' });
  await vi.advanceTimersByTimeAsync(100);        // let the backoff timer fire
  backend.expectOne('/api/x').flush({ ok: true });

  expect(result).toEqual({ ok: true });
});
```

- Use **`advanceTimersByTimeAsync`**, not `advanceTimersByTime`. RxJS schedules on timers but resolution often continues
  through promise jobs; the sync version doesn't flush the microtask queue, and an `await` after it deadlocks.
- A test that both uses fake timers and `await`s a promise (e.g. `store.place()` returning `firstValueFrom`) must
  advance the clock *between* the request and the `await`, never before subscribing.
- `backend.verify()` in `afterEach` is what catches "the retry fired one more time than I thought".

### 2. Drive hot sources with a Subject

For anything fed by a socket, SSE or an event bus, don't fake the transport — replace the service with one exposing a
`Subject` you push into. That turns an async integration into a synchronous test.

```ts
const orders$ = new Subject<Order>();
TestBed.configureTestingModule({
  providers: [{ provide: EventStream, useValue: { on: () => orders$.asObservable(), status: signal('open') } }],
});
const store = TestBed.inject(PortfolioStore);

orders$.next({ ...base, status: 'FILLED' });
orders$.next({ ...base, id: 'o2', status: 'FILLED' });
await vi.advanceTimersByTimeAsync(250);          // debounceTime(250) in the store's hook
backend.expectOne('/api/positions').flush([]);   // ONE refetch for the burst, not two
```

This is also how you test the ordering guarantees: push the SSE event *before* flushing the HTTP response and assert
`upsertIfNewer` kept the right version (`orders.store.spec.ts`).

### 3. Marble tests for pure operator logic

When the thing under test is a pipeline with no HTTP and no DI, `TestScheduler` is more precise and reads as a spec.
Inside `run()`, each character is one virtual millisecond and the async scheduler is patched automatically.

```ts
import { TestScheduler } from 'rxjs/testing';

it('collapses a burst of keystrokes into one search', () => {
  new TestScheduler((actual, expected) => expect(actual).toEqual(expected)).run(({ cold, expectObservable }) => {
    //                   typed: a@0, b@2, c@4, then a pause, d@14, blur/complete@15
    const typed = cold('a-b-c---------d|');
    expectObservable(typed.pipe(debounceTime(5))).toBe('---------c-----(d|)');
  });                                          //       c emitted at frame 9 (4 + 5 of silence);
});                                            //       d is flushed by the completion at frame 15
```

Counting frames is where marble tests go wrong, and the `(d|)` above is the reason: a pending debounced value is
**flushed when the source completes**, rather than being dropped. That's a real behaviour worth encoding in a test.

`'300ms a'` expresses longer gaps, `#` is an error, `|` completion, `^` the subscription point on a `hot()` stream, and
`expectSubscriptions` asserts *when* a source was subscribed and unsubscribed — the way to prove `switchMap` really
cancelled the previous inner stream. Keep marble tests for operator logic; the moment real HTTP or `TestBed` is
involved, virtual time and real timers mix badly, so go back to technique 1.

### Odds and ends

- **Asserting on a stream:** `await firstValueFrom(obs$)` beats collecting values in a `subscribe` callback, except
  when you need to assert how *many* values arrived — then collect into an array and assert the array.
- **Proving something is shared:** count executions with a counter in `defer`, then subscribe twice and expect `1`.
  That's the real assertion behind the dedup interceptor.
- **`toSignal`-backed components:** nothing special — emit, then `await fixture.whenStable()` and read the DOM.
  `TestBed.tick()` flushes effects if you need them run without a render.
- **A leak test is cheap:** `fixture.destroy()`, then push another value into the Subject and assert the store didn't
  change. That catches a missing `takeUntilDestroyed`.

## What's worth testing (seniors say this)
- **Behaviour with business risk:** the refresh storm, dedup semantics, retry/idempotency, store races. That's exactly
  what the 20 specs here cover.
- Pure logic (validators, reducers, computed derivations): cheap, fast, high value.
- Components: user-visible behaviour, not implementation details.
- E2E (Playwright/Cypress) for critical flows. I verified this app with a Playwright script driving real Edge:
  login redirect, live updates, order → SSE fill, guards, Lab experiments, logout closing sockets.
