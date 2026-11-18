import { computed, effect, inject, untracked } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { patchState, signalStore, withComputed, withHooks, withMethods, withProps, withState } from '@ngrx/signals';
import { map } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { trackSymbols } from '../../../core/realtime/track-symbols';
import { Instrument, PricePoint, Quote } from '../../../domain/models';
import { NewsStore } from '../../../state/news.store';
import { OrdersStore } from '../../../state/orders.store';
import { PortfolioStore } from '../../../state/portfolio.store';
import { QuotesStore } from '../../../state/quotes.store';

export const HISTORY_RANGES = [60, 180, 300] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/**
 * ================== THIS IS ANGULAR'S ANSWER TO REACT CONTEXT ==================
 *
 * No `providedIn: 'root'`. The store is listed in InstrumentDetailPage's `providers: []`, so:
 *   - every component rendered INSIDE that page (header, chart, ticket, activity) can
 *     `inject(InstrumentDetailStore)` and gets the SAME instance, with no prop drilling;
 *   - it's created when the page is created and destroyed with it (its effects and
 *     subscriptions tear down automatically);
 *   - two pages side by side would get two independent instances.
 *
 * In React you'd reach for createContext + a Provider + useContext + a reducer, then memoise to
 * avoid re-rendering every consumer. Here, hierarchical DI is the context, and signals give each
 * consumer fine-grained updates for free: the chart doesn't re-render when only the ticket's
 * dirty flag changes.
 *
 * It's a FACADE too: children don't know about the four root stores; they talk to this one.
 */
export const InstrumentDetailStore = signalStore(
  withState({ range: 180 as HistoryRange, ticketDirty: false, liveTail: [] as number[] }),

  withProps(() => ({
    /**
     * From the route as a signal, NOT a snapshot. Navigating AAPL -> MSFT reuses this component
     * instance, so a snapshot read in the constructor would go stale. That's a classic Angular bug.
     */
    symbol: toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => (p.get('symbol') ?? '').toUpperCase())), { requireSync: true }),
    // `_` prefix = private to the store: not exposed to injecting components.
    _quotes: inject(QuotesStore),
    _orders: inject(OrdersStore),
    _portfolio: inject(PortfolioStore),
    _news: inject(NewsStore),
    _apiBase: inject(APP_CONFIG).apiBaseUrl,
  })),

  withProps(({ symbol, range, _apiBase }) => ({
    /**
     * httpResource (still @experimental in v21): a reactive GET. It re-fetches whenever
     * symbol() or range() changes and cancels the previous request. It goes through
     * HttpClient, so all our interceptors apply. Think TanStack Query's useQuery, built in.
     */
    history: httpResource<PricePoint[]>(() => ({ url: `${_apiBase}/instruments/${symbol()}/history`, params: { points: range() } }), {
      defaultValue: [],
    }),
  })),

  withComputed(({ symbol, history, liveTail, _quotes, _orders, _portfolio, _news }) => ({
    // explicit `| undefined`: indexing a Record lies about missing keys
    instrument: computed<Instrument | undefined>(() => _quotes.instrumentEntityMap()[symbol()]),
    instrumentsStatus: _quotes.instrumentsStatus,
    quote: computed<Quote | undefined>(() => _quotes.quotes()[symbol()]),
    position: computed(() => _portfolio.positions().find((p) => p.symbol === symbol())),
    positionRow: computed(() => _portfolio.rows().find((p) => p.symbol === symbol())),
    orders: computed(() => _orders.sorted().filter((o) => o.symbol === symbol())),
    news: computed(() => _news.items().filter((n) => n.symbol === symbol())),
    /** Server history + ticks received since. One continuous series for the chart. */
    series: computed(() => [...(history.hasValue() ? history.value() : []).map((p) => p.price), ...liveTail()]),
  })),

  withMethods((store) => ({
    setRange(range: HistoryRange) {
      patchState(store, { range });
    },
    setTicketDirty(ticketDirty: boolean) {
      patchState(store, { ticketDirty });
    },
    cancelOrder(id: string) {
      store._orders.cancel(id);
    },
  })),

  withHooks({
    onInit(store) {
      store._quotes.loadInstruments();
      trackSymbols(() => [store.symbol()]);

      // Each new history load (symbol/range change) restarts the live tail...
      effect(() => {
        store.history.value();
        untracked(() => patchState(store, { liveTail: [] }));
      });
      // ...and each tick for this symbol extends it.
      effect(() => {
        const q = store.quote();
        if (!q) return;
        untracked(() => patchState(store, (s) => ({ liveTail: [...s.liveTail, q.price].slice(-300) })));
      });
    },
  }),
);
