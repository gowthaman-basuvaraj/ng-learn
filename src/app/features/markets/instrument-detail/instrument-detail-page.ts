import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InstrumentDetailStore } from './instrument-detail.store';
import { OrderTicket } from './order-ticket';
import { PriceChart } from './price-chart';
import { PriceHeader } from './price-header';
import { SymbolActivity } from './symbol-activity';
import { HasUnsavedChanges } from './unsaved-changes.guard';

/**
 * Note there are NO inputs passed to the children below. They all inject InstrumentDetailStore,
 * which is provided right here.
 */
@Component({
  selector: 'app-instrument-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [InstrumentDetailStore],
  imports: [RouterLink, PriceHeader, PriceChart, OrderTicket, SymbolActivity],
  template: `
    <a routerLink="/markets" class="back">← Markets</a>

    @if (!store.instrument() && store.instrumentsStatus() === 'loaded') {
      <div class="card">Unknown symbol <strong>{{ store.symbol() }}</strong>.</div>
    } @else {
      <app-price-header />
      <div class="grid">
        <!-- @defer: the chart's code is split into its own chunk and loaded when the browser is idle -->
        @defer (on idle) {
          <app-price-chart />
        } @placeholder (minimum 200ms) {
          <div class="card chart-placeholder">Loading chart…</div>
        }
        <app-order-ticket />
      </div>
      <app-symbol-activity />
    }
  `,
  styles: `
    .back { display: inline-block; margin-bottom: 12px; color: var(--muted); text-decoration: none; font-size: 13px; }
    .grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 16px; margin: 16px 0; }
    .chart-placeholder { min-height: 280px; display: grid; place-items: center; color: var(--muted); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class InstrumentDetailPage implements HasUnsavedChanges {
  protected readonly store = inject(InstrumentDetailStore);

  hasUnsavedChanges() {
    return this.store.ticketDirty();
  }
}
