# Change detection refresher (the #1 Angular interview topic)

> Mental model: **change detection = Angular walking the component tree and re-evaluating template bindings.** The
> question is always *when it runs* and *which components it checks*.

## The zone.js era (most existing codebases)
- zone.js monkey-patches every async API (events, timers, promises, XHR). When any async task finishes, Angular runs
  change detection **from the root, checking every component**.
- Simple ("it just works"), but it checks too much, and every `setInterval` or socket message triggers a full pass.
- **`OnPush`** narrows it: a component is only checked if
  1. an `@Input` reference changed,
  2. an event fired in it or its children,
  3. an `async` pipe in it emitted,
  4. a signal it reads in the template changed (v17+), or
  5. someone called `ChangeDetectorRef.markForCheck()`.
- Classic OnPush bug: mutating an array/object in place (`items.push(x)`). The reference didn't change, so the view
  doesn't update. Always produce new references (immutability).
- High-frequency streams in zone apps: `ngZone.runOutsideAngular(() => socket...)`, then re-enter or throttle UI updates.

## The zoneless era (default for new apps in v21, this repo)
- No zone.js. Change detection is **scheduled** only by: signal writes read by a template, template/host event
  listeners, `async` pipe emissions, `markForCheck()`, and view attach/detach.
- Combined with OnPush + signals, Angular only refreshes the components (and bindings) that actually depend on what changed.
- `provideZonelessChangeDetection()` (explicit in `app.config.ts`, default in v21 new apps).

### Zoneless gotchas (good to mention, I hit one)
- Mutating a plain class field from a `setTimeout`/`subscribe` callback **won't update the view**. Make it a signal.
- Reactive Forms state (`form.invalid`) isn't a signal. If it changes without a DOM event (e.g. from an effect calling
  `updateValueAndValidity()`), bind to `toSignal(form.statusChanges)` instead (`order-ticket.ts`).
- Third-party libraries that relied on zone.js to trigger updates may need a `markForCheck()`.

## Signals and change detection
A template that reads `quote()` registers that binding as a consumer. Writing the signal marks only that component
(and its ancestors' path) for refresh. Combined with **structural sharing** in stores, an AAPL tick doesn't re-render the
KO row: `quotes()['KO']` returns the same object, so the signal equality check stops propagation.

## Tools
- `ChangeDetectorRef`: `markForCheck()` (schedule), `detectChanges()` (run now, synchronously), `detach()`/`reattach()`.
- Dev-mode `ExpressionChangedAfterItHasBeenCheckedError`: you changed state *during* a check (often in
  `ngAfterViewInit`). Fix the data flow rather than wrapping it in `setTimeout`.
- Angular DevTools has a profiler that shows which components were checked and how long they took.

## 30-second answer
> "Historically zone.js triggered a top-down check after any async event, and OnPush plus immutable inputs limited the
> work. Modern Angular is zoneless: signals tell the framework exactly which views depend on what changed, so I use
> OnPush everywhere, keep state in signals, and use immutable updates so equality checks can short-circuit."
