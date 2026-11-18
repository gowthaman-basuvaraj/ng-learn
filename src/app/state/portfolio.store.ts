import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { debounceTime, filter, pipe, switchMap, tap } from 'rxjs';
import { EventStream } from '../core/realtime/event-stream.service';
import { Position } from '../domain/models';
import { TradingApi } from '../domain/trading-api';
import { QuotesStore } from './quotes.store';
import { LoadStatus, onSessionChange } from './with-session-lifecycle';

export interface PositionRow extends Position {
  last: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  live: boolean;
}

interface PortfolioState {
  cash: number;
  positions: Position[];
  status: LoadStatus;
}
const initialState: PortfolioState = { cash: 0, positions: [], status: 'idle' };

/**
 * Store composition: positions come from REST, prices from QuotesStore. P&L is DERIVED
 * (computed). It's never stored, so it can't drift out of sync with either source. Every tick
 * re-derives exactly the rows that depend on it.
 */
export const PortfolioStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ positions, cash }, quotes = inject(QuotesStore)) => {
    const rows = computed<PositionRow[]>(() =>
      positions().map((p) => {
        const q = quotes.quotes()[p.symbol];
        const last = q?.price ?? p.avgPrice;
        const marketValue = last * p.qty;
        const cost = p.avgPrice * p.qty;
        return { ...p, last, marketValue, pnl: marketValue - cost, pnlPct: cost ? ((marketValue - cost) / cost) * 100 : 0, live: !!q };
      }),
    );
    const invested = computed(() => rows().reduce((sum, r) => sum + r.marketValue, 0));
    const pnl = computed(() => rows().reduce((sum, r) => sum + r.pnl, 0));
    return {
      rows,
      invested,
      pnl,
      equity: computed(() => cash() + invested()),
      symbols: computed(() => positions().map((p) => p.symbol)),
    };
  }),
  withMethods((store, api = inject(TradingApi)) => {
    const load = rxMethod<void>(
      pipe(
        tap(() => patchState(store, { status: 'loading' })),
        switchMap(() =>
          api.portfolio().pipe(
            tapResponse({
              next: (p) => patchState(store, { cash: p.cash, positions: p.positions, status: 'loaded' }),
              error: () => patchState(store, { status: 'error' }),
            }),
          ),
        ),
      ),
    );
    return {
      load,
      positionOf(symbol: string) {
        return store.positions().find((p) => p.symbol === symbol);
      },
      onSessionStart() {
        load();
      },
      onSessionEnd() {
        patchState(store, initialState);
      },
    };
  }),
  withHooks({
    onInit(store) {
      onSessionChange({ start: () => store.onSessionStart(), end: () => store.onSessionEnd() });
      // Cross-store reaction: a fill changes positions, so re-fetch. debounceTime collapses a
      // burst of fills into one request, and switchMap (inside load) drops a stale in-flight one.
      inject(EventStream)
        .on('order')
        .pipe(
          filter((o) => o.status === 'FILLED'),
          debounceTime(250),
          takeUntilDestroyed(),
        )
        .subscribe(() => store.load());
    },
  }),
);
