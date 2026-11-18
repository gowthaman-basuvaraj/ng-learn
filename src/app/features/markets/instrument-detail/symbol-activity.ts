import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { OrderStatusBadge } from '../../../shared/order-status-badge';
import { InstrumentDetailStore } from './instrument-detail.store';

@Component({
  selector: 'app-symbol-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, OrderStatusBadge],
  template: `
    <div class="grid">
      <section class="card">
        <strong>Your {{ store.symbol() }} orders</strong>
        @for (o of store.orders(); track o.id) {
          <div class="row">
            <span class="mono">{{ o.side }} {{ o.qty }}</span>
            <span class="muted">{{ o.type }}{{ o.limitPrice ? ' @ ' + (o.limitPrice | number: '1.2-2') : '' }}</span>
            <app-order-status-badge [status]="o.status" />
            @if (o.status === 'WORKING') {
              <button type="button" class="btn btn--ghost" (click)="store.cancelOrder(o.id)">Cancel</button>
            }
          </div>
        } @empty {
          <p class="muted">No orders for this symbol yet.</p>
        }
      </section>
      <section class="card">
        <strong>{{ store.symbol() }} news</strong>
        @for (n of store.news(); track n.id) {
          <div class="row"><span>{{ n.headline }}</span><time class="muted">{{ n.ts | date: 'mediumTime' }}</time></div>
        } @empty {
          <p class="muted">No headlines yet (they arrive over SSE).</p>
        }
      </section>
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .row { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .row time { margin-left: auto; white-space: nowrap; }
    .row .btn { margin-left: auto; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class SymbolActivity {
  protected readonly store = inject(InstrumentDetailStore);
}
