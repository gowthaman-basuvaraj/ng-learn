import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, type, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { entityConfig, removeAllEntities, setAllEntities, withEntities } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { bufferTime, exhaustMap, filter, pipe, tap } from 'rxjs';
import { MarketSocket, Tick } from '../core/realtime/market-socket.service';
import { MarketApi } from '../domain/market-api';
import { Instrument, Quote } from '../domain/models';
import { LoadStatus, onSessionChange } from './with-session-lifecycle';

const instrumentConfig = entityConfig({
  entity: type<Instrument>(),
  collection: 'instrument',
  selectId: (i) => i.symbol,
});

const SPARK_POINTS = 40;
const TICK_BATCH_MS = 100;

interface QuotesState {
  quotes: Record<string, Quote>;
  /** Rolling window of recent prices per symbol, for sparklines. */
  spark: Record<string, number[]>;
  instrumentsStatus: LoadStatus;
}
const initialState: QuotesState = { quotes: {}, spark: {}, instrumentsStatus: 'idle' };

/**
 * Market data: the instrument catalogue (REST, loaded once) plus live quotes (WebSocket).
 *
 * The "one source, many views" story: the socket pushes ticks into THIS store only. The
 * watchlist, ticker tape, detail header, chart, order ticket and portfolio P&L all read
 * signals from here, so there's one subscription, one place where ticks are merged, and every
 * view stays consistent by construction.
 *
 * Performance notes:
 *  - Ticks are batched (bufferTime) into one state update per 100 ms instead of one per message.
 *  - Updates are structurally shared: a quote that didn't change keeps its object reference, so
 *    `computed(() => store.quotes()['KO'])` returns the same object, signal equality short-circuits,
 *    and components showing KO don't re-render when only AAPL ticked.
 */
export const QuotesStore = signalStore(
  { providedIn: 'root' },
  withEntities(instrumentConfig),
  withState(initialState),
  withComputed(({ instrumentEntities, quotes }) => ({
    topMovers: computed(() =>
      Object.values(quotes())
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 3),
    ),
    sectors: computed(() => [...new Set(instrumentEntities().map((i) => i.sector))].sort()),
  })),
  withMethods((store, api = inject(MarketApi)) => ({
    /** Idempotent: callable from every component that needs the catalogue; only loads once. */
    loadInstruments: rxMethod<void>(
      pipe(
        filter(() => store.instrumentsStatus() === 'idle' || store.instrumentsStatus() === 'error'),
        tap(() => patchState(store, { instrumentsStatus: 'loading' })),
        exhaustMap(() =>
          api.instruments().pipe(
            tapResponse({
              next: (list) => patchState(store, setAllEntities(list, instrumentConfig), { instrumentsStatus: 'loaded' }),
              error: () => patchState(store, { instrumentsStatus: 'error' }),
            }),
          ),
        ),
      ),
    ),

    applyTicks(ticks: Tick[]) {
      patchState(store, (state) => {
        const quotes = { ...state.quotes };
        const spark = { ...state.spark };
        for (const t of ticks) {
          if ((quotes[t.symbol]?.ts ?? 0) >= t.ts) continue; // drop stale/out-of-order ticks
          quotes[t.symbol] = t;
          spark[t.symbol] = [...(spark[t.symbol] ?? []), t.price].slice(-SPARK_POINTS);
        }
        return { quotes, spark };
      });
    },

    onSessionStart() {
      // instruments load lazily when a page asks for them
    },
    onSessionEnd() {
      patchState(store, removeAllEntities(instrumentConfig), initialState);
    },
  })),
  withHooks({
    onInit(store) {
      onSessionChange({ start: () => store.onSessionStart(), end: () => store.onSessionEnd() });
      inject(MarketSocket)
        .ticks$.pipe(
          bufferTime(TICK_BATCH_MS),
          filter((batch) => batch.length > 0),
          takeUntilDestroyed(),
        )
        .subscribe((batch) => store.applyTicks(batch));
    },
  }),
);
