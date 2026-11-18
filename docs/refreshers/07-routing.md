# Router refresher

Repo references: `app.routes.ts`, `features/markets/markets.routes.ts`, `core/auth/auth.guards.ts`,
`instrument-detail/unsaved-changes.guard.ts`, `core/title-strategy.ts`.

## Setup
```ts
provideRouter(routes,
  withComponentInputBinding(),      // :params, ?query and route data → component input()s
  withPreloading(PreloadAllModules),
  withRouterConfig({ paramsInheritanceStrategy: 'always' }),
  // withHashLocation(), withViewTransitions(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
)
```

## Route config
```ts
{
  path: 'markets/:symbol',
  loadComponent: () => import('./detail').then(m => m.DetailPage),   // lazy component (own chunk)
  // loadChildren: () => import('./markets.routes'),                // lazy child routes (default export)
  canMatch: [authGuard],          // can this route even match? (if not, its chunk isn't downloaded)
  canActivate: [roleGuard],       // may we enter?
  canDeactivate: [unsavedGuard],  // may we leave?
  resolve: { order: orderResolver },   // pre-fetch data before activating
  title: 'Detail',                // string or ResolveFn<string>
  data: { breadcrumb: 'Detail' },
  providers: [FeatureStore],      // environment injector for this subtree
  children: [...],
  redirectTo: '...', pathMatch: 'full',
}
```

## Guards and resolvers are functions now
```ts
export const authGuard: CanMatchFn = (route, segments) =>
  inject(AuthService).isAuthenticated()
    || inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: '/' + segments.join('/') } });
```
Return `true`/`false`, a `UrlTree` (redirect), or an Observable/Promise of those. Class guards (`implements CanActivate`)
are legacy.

## Reading params: the classic bug
Navigating `/markets/AAPL` → `/markets/MSFT` **reuses the same component instance**. Reading
`route.snapshot.paramMap` in the constructor gives a stale value. Use one of:
- `input()` + `withComponentInputBinding()`: `readonly symbol = input<string>()`
- `toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => p.get('symbol'))))` (what `InstrumentDetailStore` does)

## Navigating
```ts
router.navigate(['/markets', symbol]);
router.navigate([], { queryParams: { filter: 'open' }, queryParamsHandling: 'merge' });  // orders page
router.navigateByUrl('/markets');
```
`<a routerLink="/orders" routerLinkActive="active">`, `[routerLink]="['/markets', s]"`, `[queryParams]="{...}"`.

## State in the URL
Put "what am I looking at" (filters, selected tab, ids) in the URL. It's shareable, survives reloads, and the back
button works. Orders page: `?filter=open` → `input()`.

## Lazy loading and preloading
Every `loadComponent`/`loadChildren` is a chunk. `PreloadAllModules` downloads them after first paint. Write a custom
`PreloadingStrategy` for "only preload routes with `data.preload`". In templates, `@defer` lazy-loads *parts* of a page.
