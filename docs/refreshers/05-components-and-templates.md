# Components, templates, directives and pipes refresher

Repo references: `layout/*`, `features/**`, `shared/*`.

## Anatomy of a modern component

```ts
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,     // always
  imports: [DecimalPipe, RouterLink, PriceFlash],      // standalone: declare what the template uses
  host: { class: 'x', '[attr.data-status]': 'status()', '(click)': 'onClick()' },  // instead of @HostBinding/@HostListener
  template: `...`,  // or templateUrl
  styles: `...`,    // or styleUrl. Encapsulated by default (emulated)
  providers: [],    // component-scoped DI
})
export class Sparkline {
  readonly points = input.required<number[]>();       // <app-sparkline [points]="xs" />
  readonly width = input(120);                         // optional, with default
  readonly label = input('', { alias: 'aria-label', transform: (v: string) => v.trim() });
  readonly open = model(false);                        // [(open)]="flag"
  readonly selected = output<string>();                // (selected)="onSel($event)" → this.selected.emit('AAPL')
  private readonly chart = viewChild<ElementRef>('chart');   // template ref as a signal
}
```

Style guide since v20: no `Component` suffix, file `sparkline.ts`, class `Sparkline`. Older codebases use
`sparkline.component.ts` / `SparklineComponent`, and NgModules with `declarations`. Same concepts.

## Template syntax cheat sheet

```html
{{ price | number: '1.2-2' }}                  interpolation + pipe with args
[value]="search()"   [attr.aria-label]="x"     property / attribute binding
[class.up]="chg > 0" [style.width.px]="w"      class / style bindings
(click)="save()"     (keydown.enter)="go()"    events (key filters built in)
[(open)]="newsOpen"                            two-way (model() or ngModel)
<input #box> {{ box.value }}                   template reference variable

@if (quote(); as q) { … } @else if (…) { … } @else { … }
@for (r of rows(); track r.symbol; let i = $index, last = $last) { … } @empty { … }
@switch (status()) { @case ('loading') { … } @default { … } }
@let total = a() + b();
@defer (on viewport; prefetch on idle) { <heavy-chart/> } @placeholder { … } @loading (minimum 300ms) { … } @error { … }
```

- `track` is **mandatory** in `@for`. Use a stable id, never `$index` for lists that reorder.
- Template expressions should be cheap. A method call in a template runs on **every** check. Prefer
  `computed()` or a pure pipe.
- Old syntax you'll see in legacy code: `*ngIf`, `*ngFor="let x of xs; trackBy: fn"`, `[ngSwitch]`, `[ngClass]`, `[ngStyle]`.
- A literal `{` or `}` in a template must be escaped: `{{ '{' }}`.

## Content projection (= React `children` / Vue slots)

```html
<!-- card.ts template -->
<header><ng-content select="[card-title]" /></header>
<ng-content />                                   <!-- default slot -->

<!-- usage -->
<app-card><h2 card-title>Orders</h2><p>body</p></app-card>
```
`contentChild()` / `contentChildren()` query projected content. `ng-template` + `ngTemplateOutlet` gives
render props / scoped slots.

## Directives
- **Attribute directive:** adds behaviour to an existing element (`PriceFlash`: `[appPriceFlash]="price"`).
- **Structural directive:** reshapes DOM via `TemplateRef`/`ViewContainerRef` (`*ngIf` was one). Rarely hand-written now
  that control flow is built in.
- `hostDirectives: [...]` composes directives onto a component (composition over inheritance).

## Pipes
Pure by default: re-runs only when the input *reference* changes, so it's memoised and safe in hot templates. Built-ins:
`date`, `number`, `currency`, `percent`, `json`, `async`, `keyvalue`, `slice`, `titlecase`.
`async` subscribes, unsubscribes on destroy, and marks for check (pre-signals bread and butter).

## Lifecycle (still exists, needed less)
`constructor` (DI only) → `ngOnChanges` (input changes) → `ngOnInit` → `ngDoCheck` → `ngAfterContentInit/Checked` →
`ngAfterViewInit/Checked` → `ngOnDestroy`. With signals: inputs are signals (use `computed`/`effect` instead of
`ngOnChanges`), cleanup via `DestroyRef`/`takeUntilDestroyed`, DOM work via `afterNextRender`/`afterRenderEffect`.

## Styling
`ViewEncapsulation.Emulated` (default, attribute-scoped), `ShadowDom`, `None`. `:host`, `:host(.active)`,
`:host([data-status='FILLED'])` (used in `order-status-badge.ts`). `::ng-deep` is deprecated but still used
(it reaches into a child's styles). Prefer CSS custom properties for theming (see `styles.scss`).

---

# Old way vs new way: side by side

Interview codebases are often a mix. You'll **read** the old style and should **write** the new one. Each pair below
does the same thing. "Old" = Angular ≤ 15-ish (still everywhere in enterprise code). "New" = v17+ (what this repo uses).
Versions in brackets are when the new API arrived or became stable.

### 1. Declaring a component: NgModule → standalone [v14, default v17, implicit v19]

```ts
// OLD
@NgModule({
  declarations: [WatchlistComponent, SparklineComponent, SignedPipe],
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  exports: [WatchlistComponent],
})
export class MarketsModule {}

@Component({ selector: 'app-watchlist', templateUrl: './watchlist.component.html' })
export class WatchlistComponent {}
```
```ts
// NEW: the component declares its own template dependencies; no module
@Component({
  selector: 'app-watchlist',
  imports: [RouterLink, DecimalPipe, Sparkline, SignedPipe],   // only what the template uses
  templateUrl: './watchlist-page.html',
})
export class WatchlistPage {}       // (standalone: true is implied since v19)
```
Reading tip: in old code, *"why can't the template see X?"* usually means X isn't in the module's `declarations`/`imports`.

### 2. Inputs: `@Input()` → `input()` [v17.1]

```ts
// OLD
@Input() points: number[] = [];
@Input({ required: true }) symbol!: string;
@Input('aria-label') label = '';
@Input({ transform: booleanAttribute }) fill = false;

// reacting to changes
ngOnChanges(changes: SimpleChanges) {
  if (changes['points']) this.path = this.buildPath(this.points);
}
```
```ts
// NEW
readonly points = input<number[]>([]);
readonly symbol = input.required<string>();
readonly label = input('', { alias: 'aria-label' });
readonly fill = input(false, { transform: booleanAttribute });

// reacting to changes: just derive
protected readonly path = computed(() => this.buildPath(this.points()));   // no ngOnChanges
```
Template usage is identical (`<app-sparkline [points]="xs" />`), but inside the class you **call** it: `this.points()`.
Signal inputs are **read-only** inside the component. If you need to write it locally, use `linkedSignal` or `model()`.

### 3. Outputs: `@Output() EventEmitter` → `output()` [v17.3]

```ts
// OLD
@Output() selected = new EventEmitter<string>();
this.selected.emit('AAPL');
```
```ts
// NEW
readonly selected = output<string>();
this.selected.emit('AAPL');

// bonus: expose an Observable as an output
readonly ticks = outputFromObservable(this.ticks$);
```
Parent usage is unchanged: `<app-row (selected)="open($event)" />`.

### 4. Two-way binding: `@Input` + `@Output xChange` → `model()` [v17.2]

```ts
// OLD: the naming convention (open + openChange) makes [(open)] work
@Input() open = false;
@Output() openChange = new EventEmitter<boolean>();
close() { this.open = false; this.openChange.emit(false); }
```
```ts
// NEW (see layout/news-panel.ts)
readonly open = model(false);
close() { this.open.set(false); }        // updates the parent automatically
```
```html
<app-news-panel [(open)]="newsOpen" />   <!-- same in both; newsOpen can be a signal in new code -->
```

### 5. Control flow: structural directives → built-in blocks [v17]

```html
<!-- OLD -->
<div *ngIf="quote$ | async as q; else loading">{{ q.price }}</div>
<ng-template #loading>Loading…</ng-template>

<tr *ngFor="let row of rows; trackBy: trackBySymbol; let i = index">…</tr>
<!-- trackBySymbol(i: number, r: Row) { return r.symbol; }  lives in the class -->

<ng-container [ngSwitch]="status">
  <span *ngSwitchCase="'loading'">…</span>
  <span *ngSwitchDefault>…</span>
</ng-container>
```
```html
<!-- NEW -->
@if (quote(); as q) { {{ q.price }} } @else { Loading… }

@for (row of rows(); track row.symbol; let i = $index) { <tr>…</tr> } @empty { <tr>No rows</tr> }

@switch (status()) {
  @case ('loading') { <span>…</span> }
  @default { <span>…</span> }
}
```
Wins: no imports (`NgIf`/`NgFor` needed `CommonModule`), `track` is **mandatory** (a perf foot-gun is removed), `@empty`,
better type narrowing, faster. Migration: `ng generate @angular/core:control-flow`.

### 6. Local template variables: `*ngIf … as` hack → `@let` [v18.1]

```html
<!-- OLD: abusing ngIf just to name a value (and breaking on falsy values like 0) -->
<ng-container *ngIf="{ total: total$ | async, count: count$ | async } as vm">
  {{ vm.total }} / {{ vm.count }}
</ng-container>
```
```html
<!-- NEW -->
@let total = portfolio.equity();
@let positions = portfolio.rows().length;
{{ total | currency }} across {{ positions }} positions
```

### 7. Host bindings: `@HostBinding` / `@HostListener` → `host: {}` [recommended since v17+]

```ts
// OLD
@HostBinding('class.active') active = false;
@HostBinding('attr.data-status') get statusAttr() { return this.status; }
@HostListener('click', ['$event']) onClick(e: MouseEvent) { … }
@HostListener('window:resize') onResize() { … }
```
```ts
// NEW (see shared/order-status-badge.ts, shared/price-flash.directive.ts)
@Component({
  host: {
    '[class.active]': 'active()',
    '[attr.data-status]': 'status()',
    '(click)': 'onClick($event)',
    '(window:resize)': 'onResize()',
  },
})
```

### 8. Element and child queries: `@ViewChild` → `viewChild()` [v17.2]

```ts
// OLD
@ViewChild('chart') chart!: ElementRef<HTMLCanvasElement>;           // undefined until ngAfterViewInit
@ViewChild(Sparkline) spark?: Sparkline;
@ViewChildren(RowComponent) rows!: QueryList<RowComponent>;
@ContentChild(CardTitle) title?: CardTitle;

ngAfterViewInit() { this.draw(this.chart.nativeElement); }
```
```ts
// NEW
private readonly chart = viewChild.required<ElementRef<HTMLCanvasElement>>('chart');
private readonly spark = viewChild(Sparkline);                      // Signal<Sparkline | undefined>
private readonly rows = viewChildren(RowComponent);                  // Signal<readonly RowComponent[]>
private readonly title = contentChild(CardTitle);

constructor() {
  afterNextRender(() => this.draw(this.chart().nativeElement));      // DOM is guaranteed to exist
}
```
Bonus: queries are signals, so `computed(() => this.rows().length)` just works. There's no `QueryList.changes` subscription.

### 9. Dependency injection: constructor params → `inject()` [v14]

```ts
// OLD
constructor(
  private readonly http: HttpClient,
  private readonly route: ActivatedRoute,
  @Inject(APP_CONFIG) private readonly config: AppConfig,
  @Optional() @SkipSelf() private readonly parent?: ParentStore,
) {}
```
```ts
// NEW
private readonly http = inject(HttpClient);
private readonly route = inject(ActivatedRoute);
private readonly config = inject(APP_CONFIG);
private readonly parent = inject(ParentStore, { optional: true, skipSelf: true });
```
Works in functions too (guards, interceptors, `trackSymbols()`), so it composes like hooks.

### 10. Local state and view updates: fields + `markForCheck` → signals

```ts
// OLD (OnPush component, data arriving asynchronously)
orders: Order[] = [];
constructor(private api: TradingApi, private cdr: ChangeDetectorRef) {}
ngOnInit() {
  this.api.orders().subscribe(o => { this.orders = o; this.cdr.markForCheck(); });   // forget markForCheck = stale view
}
```
```ts
// NEW
protected readonly orders = signal<Order[]>([]);
constructor() {
  inject(TradingApi).orders().pipe(takeUntilDestroyed()).subscribe(o => this.orders.set(o));   // view updates itself
}
// or simply:
protected readonly orders = toSignal(inject(TradingApi).orders(), { initialValue: [] });
```

### 11. Observables in templates: `async` pipe → `toSignal`

```ts
// OLD
quote$ = this.store.select(selectQuote);
// <span>{{ (quote$ | async)?.price }}</span>
// pitfall: two async pipes on the same cold stream = two subscriptions (two HTTP calls!)
```
```ts
// NEW
quote = toSignal(this.quote$);          // or store.selectSignal(selectQuote) in classic NgRx
// <span>{{ quote()?.price }}</span>    read it as many times as you like: one subscription
```
`async` is **not** deprecated and is still fine. Signals just compose better (`computed`) and read nicer.

### 12. Cleanup: `Subject` + `takeUntil` + `ngOnDestroy` → `takeUntilDestroyed` / `DestroyRef`

```ts
// OLD
private readonly destroy$ = new Subject<void>();
ngOnInit() { this.socket.ticks$.pipe(takeUntil(this.destroy$)).subscribe(...); }
ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
```
```ts
// NEW
constructor() {
  this.socket.ticks$.pipe(takeUntilDestroyed()).subscribe(...);   // in an injection context
}
// outside the constructor: takeUntilDestroyed(this.destroyRef)
// non-RxJS teardown:
inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
```

### 13. Lifecycle-driven side effects → `effect()`

```ts
// OLD
ngOnChanges(changes: SimpleChanges) {
  if (changes['symbol']) {
    this.socket.unsubscribe(changes['symbol'].previousValue);
    this.socket.subscribe(changes['symbol'].currentValue);
  }
}
ngOnDestroy() { this.socket.unsubscribe(this.symbol); }
```
```ts
// NEW (see core/realtime/track-symbols.ts)
constructor() {
  effect((onCleanup) => {
    const release = this.socket.retain([this.symbol()]);
    onCleanup(release);                  // runs on change AND on destroy, so it can't leak
  });
}
```

### 14. Class and style bindings: `ngClass`/`ngStyle` → native bindings

```html
<!-- OLD -->
<td [ngClass]="{ up: q.change > 0, down: q.change < 0 }" [ngStyle]="{ 'width.px': w }"></td>
```
```html
<!-- NEW (no NgClass/NgStyle import needed) -->
<td [class.up]="q.change > 0" [class.down]="q.change < 0" [style.width.px]="w"></td>
<td [class]="{ up: q.change > 0, down: q.change < 0 }"></td>   <!-- object/array forms work too -->
```

### 15. Lazy loading part of a page: `*ngIf` + manual dynamic import → `@defer` [v17]

```ts
// OLD
async showChart() {
  const { PriceChartComponent } = await import('./price-chart.component');
  this.vcr.createComponent(PriceChartComponent);       // ViewContainerRef plumbing
}
```
```html
<!-- NEW (see instrument-detail-page.ts) -->
@defer (on viewport; prefetch on idle) {
  <app-price-chart />
} @placeholder { <div>Chart</div> } @loading (minimum 200ms) { <spinner /> } @error { Failed to load }
```
Triggers: `on idle | viewport | interaction | hover | immediate | timer(2s)`, or `when someSignal()`.

### 16. Dynamic components: `ComponentFactoryResolver` → `ViewContainerRef.createComponent` / `NgComponentOutlet`

```ts
// OLDER (removed in practice; you may still see it)
const factory = this.cfr.resolveComponentFactory(AlertComponent);
const ref = this.vcr.createComponent(factory);
ref.instance.message = 'Saved';
```
```ts
// NEW
const ref = this.vcr.createComponent(AlertComponent);
ref.setInput('message', 'Saved');          // works with signal inputs, triggers change detection correctly
```
```html
<ng-container *ngComponentOutlet="widget(); inputs: { symbol: 'AAPL' }" />
```

### 17. Route params: snapshot / subscribe → input binding

```ts
// OLD
constructor(private route: ActivatedRoute) {}
ngOnInit() {
  this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(p => this.load(p.get('symbol')!));
}
```
```ts
// NEW (needs provideRouter(routes, withComponentInputBinding()))
readonly symbol = input.required<string>();        // :symbol, ?query and route data map to inputs
constructor() { effect(() => this.load(this.symbol())); }
```

### 18. Forms: untyped → typed [v14]

```ts
// OLD: everything is `any`
form = new FormGroup({ qty: new FormControl(10) });
const qty = this.form.value.qty;                     // any
```
```ts
// NEW
form = inject(NonNullableFormBuilder).group({ qty: [10, Validators.required] });
const { qty } = this.form.getRawValue();             // number
```
(Signal Forms are the next step, still experimental in v21.)

### Cheat line for the interview
> "Old Angular: NgModules, decorators (`@Input/@Output/@ViewChild/@HostBinding`), `*ngIf/*ngFor`, lifecycle hooks plus
> `takeUntil` for cleanup, and zone.js driving change detection. New Angular: standalone components, signal-based
> `input/output/model/viewChild`, built-in control flow and `@defer`, `inject()`, `computed`/`effect` instead of most
> lifecycle hooks, `takeUntilDestroyed`, and zoneless change detection. The concepts didn't change; the APIs became
> functional and reactive, which feels a lot like moving from React classes to hooks."
