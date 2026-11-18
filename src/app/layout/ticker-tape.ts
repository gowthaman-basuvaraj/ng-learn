import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { trackSymbols } from '../core/realtime/track-symbols';
import { PriceFlash } from '../shared/price-flash.directive';
import { SignedPipe } from '../shared/signed.pipe';
import { QuotesStore } from '../state/quotes.store';

const TAPE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'JPM'];

/** Consumer #1 of live ticks. It knows nothing about sockets; it reads the store and declares interest. */
@Component({
  selector: 'app-ticker-tape',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe, SignedPipe, PriceFlash],
  template: `
    <nav class="tape" aria-label="Ticker tape">
      @for (item of items(); track item.symbol) {
        <a class="tape__item" [routerLink]="['/markets', item.symbol]">
          <span class="tape__sym">{{ item.symbol }}</span>
          @if (item.quote; as q) {
            <span class="mono" [appPriceFlash]="q.price">{{ q.price | number: '1.2-2' }}</span>
            <span class="mono" [class.up]="q.change > 0" [class.down]="q.change < 0">{{ q.changePct | signed: 2 : '%' }}</span>
          } @else {
            <span class="muted">-</span>
          }
        </a>
      }
    </nav>
  `,
  styles: `
    .tape { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    .tape__item { display: flex; gap: 6px; align-items: baseline; padding: 4px 8px; border-radius: 6px; color: inherit; text-decoration: none; white-space: nowrap; font-size: 12px; }
    .tape__item:hover { background: var(--surface-2); }
    .tape__sym { font-weight: 600; }
  `,
})
export class TickerTape {
  private readonly quotes = inject(QuotesStore);
  protected readonly items = computed(() => TAPE.map((symbol) => ({ symbol, quote: this.quotes.quotes()[symbol] })));

  constructor() {
    trackSymbols(() => TAPE);
  }
}
