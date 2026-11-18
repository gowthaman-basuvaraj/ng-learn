# Dependency injection refresher

> Mental model: **a tree of injectors that mirrors your app.** `inject(X)` walks up from where you are until some
> injector provides X. Where you *provide* something decides its lifetime and who shares it.

Repo references: `app.config.ts`, `core/config/app-config.ts`, `instrument-detail.store.ts` + page, `lab-api.ts`.

## Where you provide = lifetime + sharing

| Provided in | Instance | Lives | Example here |
|---|---|---|---|
| `@Injectable({ providedIn: 'root' })` | one per app (tree-shakable) | app lifetime | `AuthService`, `QuotesStore` |
| `bootstrapApplication(App, { providers })` (`app.config.ts`) | one per app | app lifetime | `APP_CONFIG`, HttpClient config |
| Route `providers: [...]` | one per route's environment injector | **not** destroyed on navigate-away | n/a |
| Component `providers: [...]` | **one per component instance**, shared by its subtree | destroyed with the component | `InstrumentDetailStore`, `LabApi` |
| Component `viewProviders` | like `providers`, but hidden from projected content | | n/a |

**The React Context equivalent is component `providers` + `inject()` in descendants.** No Provider component, no
`useContext`, no re-render-every-consumer problem. Each consumer reads the signals it needs.

## `providedIn`: every value, when to use it

`providedIn` lets a class register **itself** with an injector, so nobody has to list it in a `providers` array. The
values accepted by v21's public API:

| Value | Meaning | Status | Use it for |
|---|---|---|---|
| `'root'` | one instance in the application's root environment injector | ✅ the default choice | app-wide services, root stores, API clients |
| *omitted* / `null` | not registered anywhere; **you must list it** in some `providers` | ✅ | per-component / per-route instances (scoped state) |
| `'platform'` | one instance in the *platform* injector, shared by **all Angular apps on the page** | ✅ rare | micro-frontends / Angular Elements that share one bus |
| `'any'` | one instance per lazy-loaded NgModule injector | ⚠️ deprecated | legacy only. Use route `providers` instead |
| `SomeNgModule` (a type) | provided wherever that NgModule is imported | ⚠️ deprecated | legacy only. Use `'root'` or explicit `providers` |

### `providedIn: 'root'`: the 95% case

```ts
@Injectable({ providedIn: 'root' })
export class MarketApi {                         // src/app/domain/market-api.ts
  private readonly http = inject(HttpClient);
  instruments() { return this.http.get<Instrument[]>('/api/instruments'); }
}

// any component, guard, interceptor, store:
private readonly api = inject(MarketApi);       // same instance everywhere
```

Why it beats listing the class in `app.config.ts`:
- **Tree-shakable.** If nothing injects `MarketApi`, it's dropped from the bundle. A class listed in a `providers` array is
  always bundled.
- **Lazy-chunk friendly.** If only a lazy route uses it, its *code* lands in that route's chunk, but the *instance* is
  still the root singleton: created on first `inject()`, then shared.
- **Created lazily.** Nothing is instantiated until someone first injects it. (That's why this app's realtime
  layer only connects once a store is injected by the shell.)

`'root'` also works with an alternative recipe, directly in the decorator:

```ts
// abstract "interface" token with a default implementation. Tests or apps can still override it
@Injectable({ providedIn: 'root', useClass: LocalStorageCache })
export abstract class Cache { abstract get(k: string): string | null; }

@Injectable({ providedIn: 'root', useFactory: () => new Clock(() => Date.now()) })
export class Clock { constructor(readonly now: () => number) {} }
```

And on **InjectionTokens**, for non-class values with a sensible default:

```ts
export const WINDOW = new InjectionToken<Window>('WINDOW', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView!,   // factory runs in an injection context
});
export const API_TIMEOUT_MS = new InjectionToken<number>('API_TIMEOUT_MS', {
  providedIn: 'root',
  factory: () => 10_000,                          // default; override with { provide: API_TIMEOUT_MS, useValue: 30_000 }
});
```

(This repo's `APP_CONFIG` is a token *without* a default, provided via `provideAppConfig()`. That's a deliberate
choice: forgetting to configure it should fail loudly, not silently fall back to a default.)

NgRx SignalStore uses the same idea: `signalStore({ providedIn: 'root' }, ...)` (`QuotesStore`, `OrdersStore`, …).

### No `providedIn`: you decide where it lives (scoped instances)

```ts
@Injectable()                                   // not registered anywhere on its own
export class LabApi { ... }                     // src/app/features/lab/lab-api.ts

@Component({ providers: [LabApi], ... })        // one instance per LabPage, destroyed with it
export class LabPage { private api = inject(LabApi); }

// SignalStore equivalent: just omit the config object
export const InstrumentDetailStore = signalStore(withState(...), ...);
@Component({ providers: [InstrumentDetailStore] })   // the "context" pattern
```

Use it when:
- **State must not be shared.** Two detail pages side by side must not share a ticket draft.
- **State should die with the UI.** Leave the page and the store, its effects and its subscriptions are all torn down.
- **It only makes sense inside a feature.** Injecting it anywhere else is a bug, and you *want* the error:
  `NullInjectorError: No provider for LabApi!`

Same for route-level scope:

```ts
{ path: 'admin', providers: [AdminStore], loadChildren: () => import('./admin.routes') }
// ⚠ the route's environment injector is NOT destroyed when you navigate away. The instance lives on.
```

### `providedIn: 'platform'`: shared across apps on one page

```ts
@Injectable({ providedIn: 'platform' })
export class CrossAppBus {                      // one instance for EVERY Angular app bootstrapped in this page
  private readonly subject = new Subject<AppEvent>();
  readonly events$ = this.subject.asObservable();
  emit(e: AppEvent) { this.subject.next(e); }
}
```

The platform injector sits *above* every app's root injector. It only matters when one page boots **several** Angular
apps: micro-frontends (Module Federation / Native Federation), or multiple Angular Elements (web components) from separate
`createApplication()` calls. Typical uses: a shared event bus, shared analytics/telemetry client, shared feature-flag
cache. Caveats: these services can't depend on anything app-level (no `Router`, no app `HttpClient` interceptors), and
in a normal single-app product you'll never need it. Knowing it exists and why is the senior signal.

### `providedIn: 'any'` (deprecated)

```ts
@Injectable({ providedIn: 'any' })              // ⚠ deprecated
export class FeatureCache {}
```
Gave every **lazy-loaded NgModule** its own instance, while eager modules shared one. It was confusing (whether you got a
shared or a separate instance depended on how the *consumer* was loaded) and tied to NgModules.
**Modern replacement:** be explicit with route-level `providers: [FeatureCache]`.

### `providedIn: SomeModule` (deprecated)

```ts
@Injectable({ providedIn: AdminModule })        // ⚠ deprecated
export class AdminService {}
```
Meant "available wherever `AdminModule` is imported". It created subtle circular-import problems, and standalone apps
have no NgModules. **Replacement:** `'root'` (tree-shaking already gives you the bundle benefit) or explicit `providers`.
You'll still see both deprecated forms in older enterprise code, so recognise them and know what replaced them.

### Overriding a `'root'` service (shadowing)

`providedIn: 'root'` is just the *default* registration. Any closer injector can provide its own:

```ts
@Component({
  selector: 'app-embedded-widget',
  providers: [{ provide: ToastService, useClass: SilentToastService }],   // this subtree gets a different toaster
})
export class EmbeddedWidget {}

// tests
TestBed.configureTestingModule({ providers: [{ provide: MarketApi, useValue: fakeApi }] });
```

⚠️ **Classic bug:** listing a `providedIn: 'root'` service in a component's `providers` *by accident*:

```ts
@Component({ providers: [AuthService] })        // ❌ creates a SECOND AuthService for this subtree
```
Everything under that component sees a fresh, empty instance: "the user is logged in, but this page says they aren't."
If it's `providedIn: 'root'`, **don't** list it again unless you mean to shadow it.

### Quick decision guide
1. App-wide, stateless or a global singleton? → `providedIn: 'root'`.
2. State that belongs to one screen or component subtree? → no `providedIn` + component `providers`.
3. A config value with a sensible default? → `InjectionToken` with `providedIn: 'root'` + `factory`.
4. A config value that *must* be supplied? → token without a factory + a `provideX()` function.
5. Several Angular apps on one page sharing something? → `'platform'`.
6. `'any'` or a module type? → only when reading legacy code.

### Interview one-liners
- *"`providedIn: 'root'` is a tree-shakable singleton, created lazily on first inject."*
- *"Omitting `providedIn` and using component `providers` gives one instance per component subtree. That's how I scope
  feature state, Angular's equivalent of React Context."*
- *"`'platform'` is above the app root. It's only useful when multiple apps share a page."*
- *"`'any'` and module-typed `providedIn` are deprecated. Route-level providers replaced them."*

## Ways to provide

```ts
providers: [
  MyService,                                            // = { provide: MyService, useClass: MyService }
  { provide: Logger, useClass: ConsoleLogger },         // swap the implementation
  { provide: APP_CONFIG, useValue: config },            // plain values need an InjectionToken
  { provide: Api, useFactory: () => new Api(inject(HttpClient)) },
  { provide: OldName, useExisting: NewName },           // alias
  { provide: VALIDATORS, useValue: v, multi: true },    // multi: collect many into an array
]
export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');
```

`makeEnvironmentProviders([...])` + a `provideX()` function is the modern way to package config (see `provideAppConfig()`,
and every `provideRouter`/`provideHttpClient` you use).

## inject()

```ts
private readonly http = inject(HttpClient);
private readonly cfg = inject(APP_CONFIG);
private readonly parent = inject(ParentStore, { optional: true, skipSelf: true });
```

- Only valid in an **injection context**: field initialisers, constructors, `provide*` factories, guards, resolvers,
  interceptors, SignalStore `withX` factories and hooks, `runInInjectionContext(injector, fn)`.
- Modifiers: `optional` (null instead of an error), `self` (only this injector), `skipSelf` (start at the parent), `host`.
- Why it beats constructor injection: works in plain functions (enabling "custom hook"-style helpers like
  `trackSymbols()`), plays well with inheritance, and needs no decorator metadata.

## Two injector hierarchies (interview trivia that comes up)
1. **Environment injectors:** root → lazy route injectors. Services and app-wide config.
2. **Element (node) injectors:** created by components/directives with `providers`. Resolution checks the element
   tree first, then falls back to environment injectors.

## Testing
`TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: fakeApi }] })`. The consumer never changes.
That's the big practical win over module imports.

## Smells
- Everything `providedIn: 'root'` "just because": a feature-scoped store should be component-provided.
- Services with mutable public fields: expose read-only signals plus methods.
- Using `Injector.get` everywhere (service locator) instead of `inject()` at construction.
