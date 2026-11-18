import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { PriceFlash } from '../../../shared/price-flash.directive';
import { SignedPipe } from '../../../shared/signed.pipe';
import { InstrumentDetailStore } from './instrument-detail.store';

/** Consumer #3 of live ticks, via the page-scoped store (the "context"). */
@Component({
  selector: 'app-price-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, CurrencyPipe, SignedPipe, PriceFlash],
  template: `
    <section class="head card">
      <div>
        <h1>{{ store.symbol() }}</h1>
        <div class="muted">{{ store.instrument()?.name }} · {{ store.instrument()?.sector }}</div>
      </div>
      @if (store.quote(); as q) {
        <div class="px">
          <span class="mono big" [appPriceFlash]="q.price">{{ q.price | number: '1.2-2' }}</span>
          <span class="mono" [class.up]="q.change > 0" [class.down]="q.change < 0">{{ q.change | signed }} ({{ q.changePct | signed: 2 : '%' }})</span>
        </div>
      } @else {
        <div class="px muted">Waiting for first tick…</div>
      }
      @if (store.positionRow(); as p) {
        <div class="pos">
          <div class="muted">Position</div>
          <div class="mono">{{ p.qty }} @ {{ p.avgPrice | currency }}</div>
          <div class="mono" [class.up]="p.pnl > 0" [class.down]="p.pnl < 0">{{ p.pnl | signed }} ({{ p.pnlPct | signed: 2 : '%' }})</div>
        </div>
      }
    </section>
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    h1 { margin: 0; }
    .px { display: grid; gap: 2px; }
    .big { font-size: 28px; font-weight: 600; border-radius: 4px; padding: 0 4px; }
    .pos { margin-left: auto; text-align: right; display: grid; gap: 2px; font-size: 13px; }
  `,
})
export class PriceHeader {
  protected readonly store = inject(InstrumentDetailStore);
}
