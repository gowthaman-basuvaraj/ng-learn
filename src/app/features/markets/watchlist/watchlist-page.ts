import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { trackSymbols } from '../../../core/realtime/track-symbols';
import { PriceFlash } from '../../../shared/price-flash.directive';
import { SignedPipe } from '../../../shared/signed.pipe';
import { Sparkline } from '../../../shared/sparkline';
import { QuotesStore } from '../../../state/quotes.store';

type SortKey = 'symbol' | 'price' | 'changePct';

/**
 * Consumer #2 of live ticks. Local UI state (search, sort, sector) lives in plain component
 * signals. It's not global, so it doesn't go in a store. Knowing what NOT to put in a store
 * is half the job.
 */
@Component({
  selector: 'app-watchlist-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe, SignedPipe, Sparkline, PriceFlash],
  templateUrl: './watchlist-page.html',
  styleUrl: './watchlist-page.scss',
})
export class WatchlistPage {
  protected readonly store = inject(QuotesStore);
  private readonly router = inject(Router);

  protected readonly search = signal('');
  protected readonly sector = signal<string>('all');
  protected readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>({ key: 'symbol', dir: 1 });

  /**
   * linkedSignal: writable, but RESETS whenever its source changes. Here the keyboard-focused row
   * resets to the top whenever the filter changes. Without it you'd write an effect that sets a
   * signal, which is the classic anti-pattern.
   */
  protected readonly activeIndex = linkedSignal({ source: () => [this.search(), this.sector()], computation: () => 0 });

  protected readonly rows = computed(() => {
    const q = this.search().trim().toUpperCase();
    const sector = this.sector();
    const { key, dir } = this.sort();
    const quotes = this.store.quotes();
    const spark = this.store.spark();
    return this.store
      .instrumentEntities()
      .filter((i) => (sector === 'all' || i.sector === sector) && (!q || i.symbol.includes(q) || i.name.toUpperCase().includes(q)))
      .map((i) => ({ ...i, quote: quotes[i.symbol], spark: spark[i.symbol] ?? [] }))
      .sort((a, b) => {
        const av = key === 'symbol' ? a.symbol : (a.quote?.[key] ?? 0);
        const bv = key === 'symbol' ? b.symbol : (b.quote?.[key] ?? 0);
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      });
  });

  /**
   * `rows` recomputes on every tick (prices changed), but the SET of visible symbols rarely does.
   * A custom `equal` stops this computed from notifying dependants when the set is the same, so
   * the subscription effect below doesn't re-run 10x a second. It's the signals version of
   * React's "stable dependency" problem, solved at the source.
   */
  private readonly visibleSymbols = computed(() => this.rows().map((r) => r.symbol).sort(), {
    equal: (a, b) => a.length === b.length && a.every((s, i) => s === b[i]),
  });

  constructor() {
    this.store.loadInstruments();
    // Subscribe only to the rows that are visible. Filter the list and the socket unsubscribes the rest.
    trackSymbols(this.visibleSymbols);
  }

  protected toggleSort(key: SortKey) {
    this.sort.update((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 }));
  }

  protected onKeydown(event: KeyboardEvent) {
    const count = this.rows().length;
    if (!count) return;
    if (event.key === 'ArrowDown') this.activeIndex.update((i) => Math.min(count - 1, i + 1));
    else if (event.key === 'ArrowUp') this.activeIndex.update((i) => Math.max(0, i - 1));
    else if (event.key === 'Enter') void this.router.navigate(['/markets', this.rows()[this.activeIndex()].symbol]);
    else return;
    event.preventDefault();
  }
}
