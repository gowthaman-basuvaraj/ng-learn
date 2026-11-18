import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { trackSymbols } from '../../core/realtime/track-symbols';
import { PriceFlash } from '../../shared/price-flash.directive';
import { SignedPipe } from '../../shared/signed.pipe';
import { PortfolioStore } from '../../state/portfolio.store';

/** Consumer #6 of live ticks: P&L is a computed() joining two stores. */
@Component({
  selector: 'app-portfolio-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, SignedPipe, PriceFlash, RouterLink],
  template: `
    <section class="page-head">
      <div>
        <h1>Portfolio</h1>
        <p class="muted">Positions from REST, prices from WebSocket, P&amp;L derived and never stored.</p>
      </div>
    </section>

    <div class="stats">
      <div class="card stat"><span class="muted">Equity</span><span class="mono">{{ store.equity() | currency }}</span></div>
      <div class="card stat"><span class="muted">Invested</span><span class="mono">{{ store.invested() | currency }}</span></div>
      <div class="card stat"><span class="muted">Cash</span><span class="mono">{{ store.cash() | currency }}</span></div>
      <div class="card stat">
        <span class="muted">Unrealised P&amp;L</span>
        <span class="mono" [class.up]="store.pnl() > 0" [class.down]="store.pnl() < 0" [appPriceFlash]="store.pnl()">{{ store.pnl() | signed }}</span>
      </div>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th>Symbol</th><th class="num">Qty</th><th class="num">Avg</th><th class="num">Last</th><th class="num">Value</th><th class="num">P&amp;L</th></tr>
        </thead>
        <tbody>
          @for (r of store.rows(); track r.symbol) {
            <tr class="clickable" [routerLink]="['/markets', r.symbol]">
              <td><strong>{{ r.symbol }}</strong></td>
              <td class="num mono">{{ r.qty }}</td>
              <td class="num mono">{{ r.avgPrice | number: '1.2-2' }}</td>
              <td class="num mono" [appPriceFlash]="r.last" [class.muted]="!r.live">{{ r.last | number: '1.2-2' }}</td>
              <td class="num mono">{{ r.marketValue | currency }}</td>
              <td class="num mono" [class.up]="r.pnl > 0" [class.down]="r.pnl < 0">{{ r.pnl | signed }} ({{ r.pnlPct | signed: 2 : '%' }})</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">{{ store.status() === 'loading' ? 'Loading…' : 'No positions.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { display: grid; gap: 4px; }
    .stat .mono { font-size: 20px; font-weight: 600; border-radius: 4px; }
  `,
})
export class PortfolioPage {
  protected readonly store = inject(PortfolioStore);

  constructor() {
    trackSymbols(this.store.symbols);
  }
}
