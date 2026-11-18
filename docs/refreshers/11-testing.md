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

## What's worth testing (seniors say this)
- **Behaviour with business risk:** the refresh storm, dedup semantics, retry/idempotency, store races. That's exactly
  what the 20 specs here cover.
- Pure logic (validators, reducers, computed derivations): cheap, fast, high value.
- Components: user-visible behaviour, not implementation details.
- E2E (Playwright/Cypress) for critical flows. I verified this app with a Playwright script driving real Edge:
  login redirect, live updates, order → SSE fill, guards, Lab experiments, logout closing sockets.
