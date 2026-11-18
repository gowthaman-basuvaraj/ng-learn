import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Sparkline } from '../../../shared/sparkline';
import { HISTORY_RANGES, InstrumentDetailStore } from './instrument-detail.store';

/** Consumer #4 of live ticks: server history (httpResource) + live tail, merged in the store. */
@Component({
  selector: 'app-price-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sparkline],
  template: `
    <section class="card">
      <header class="row">
        <strong>Price</strong>
        <div class="seg" role="group" aria-label="History range">
          @for (r of ranges; track r) {
            <button type="button" [class.on]="store.range() === r" (click)="store.setRange(r)">{{ r }}s</button>
          }
        </div>
      </header>
      @if (store.history.error()) {
        <p class="muted">Couldn't load history. <button type="button" class="btn" (click)="store.history.reload()">Retry</button></p>
      } @else {
        <div class="chart" [class.loading]="store.history.isLoading()">
          <app-sparkline [points]="store.series()" [width]="720" [height]="240" [fill]="true" />
        </div>
        <p class="muted small">{{ store.history.value().length }} historical points + {{ store.liveTail().length }} live ticks</p>
      }
    </section>
  `,
  styles: `
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .seg { display: inline-flex; background: var(--surface-2); border-radius: 6px; padding: 2px; }
    .seg button { background: none; border: 0; color: var(--muted); padding: 4px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px; }
    .seg button.on { background: var(--surface); color: var(--text); }
    .chart { transition: opacity .2s; }
    .chart.loading { opacity: .4; }
    .chart ::ng-deep svg { width: 100%; height: auto; }
    .small { font-size: 12px; margin: 6px 0 0; }
  `,
})
export class PriceChart {
  protected readonly store = inject(InstrumentDetailStore);
  protected readonly ranges = HISTORY_RANGES;
}
