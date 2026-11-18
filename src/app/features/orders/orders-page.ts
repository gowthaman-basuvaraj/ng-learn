import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { OrderStatus, TERMINAL_STATUSES } from '../../domain/models';
import { OrderStatusBadge } from '../../shared/order-status-badge';
import { OrdersStore } from '../../state/orders.store';

type Filter = 'all' | 'open' | 'done';

/**
 * The filter lives in the URL (?filter=open), bound to an input() by withComponentInputBinding.
 * URL state is shareable, survives reloads, and the back button works, so it's the right home
 * for "what am I looking at" state.
 */
@Component({
  selector: 'app-orders-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, OrderStatusBadge],
  template: `
    <section class="page-head">
      <div>
        <h1>Orders</h1>
        <p class="muted">Status changes arrive over Server-Sent Events. No polling.</p>
      </div>
      <div class="seg" role="group" aria-label="Filter">
        @for (f of filters; track f) {
          <button type="button" [class.on]="activeFilter() === f" (click)="setFilter(f)">{{ f }}</button>
        }
      </div>
    </section>

    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th>Time</th><th>Symbol</th><th>Side</th><th class="num">Qty</th><th>Type</th><th class="num">Fill</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          @for (o of visible(); track o.id) {
            <tr>
              <td class="mono muted">{{ o.createdAt | date: 'HH:mm:ss' }}</td>
              <td><a [routerLink]="['/markets', o.symbol]">{{ o.symbol }}</a></td>
              <td [class.up]="o.side === 'BUY'" [class.down]="o.side === 'SELL'">{{ o.side }}</td>
              <td class="num mono">{{ o.qty }}</td>
              <td>{{ o.type }}{{ o.limitPrice ? ' @ ' + (o.limitPrice | number: '1.2-2') : '' }}</td>
              <td class="num mono">{{ o.fillPrice ? (o.fillPrice | number: '1.2-2') : '-' }}</td>
              <td><app-order-status-badge [status]="o.status" /></td>
              <td>
                @if (o.status === 'WORKING') {
                  <button type="button" class="btn btn--ghost" (click)="store.cancel(o.id)">Cancel</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="muted">No orders. Place one from any instrument page.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .seg { display: inline-flex; background: var(--surface-2); border-radius: 6px; padding: 2px; }
    .seg button { background: none; border: 0; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 13px; text-transform: capitalize; }
    .seg button.on { background: var(--surface); color: var(--text); }
  `,
})
export class OrdersPage {
  protected readonly store = inject(OrdersStore);
  private readonly router = inject(Router);

  readonly filter = input<string>(); // <- ?filter=...
  protected readonly filters: Filter[] = ['all', 'open', 'done'];
  protected readonly activeFilter = computed<Filter>(() => (this.filters as string[]).includes(this.filter() ?? '') ? (this.filter() as Filter) : 'all');

  protected readonly visible = computed(() => {
    const f = this.activeFilter();
    const isDone = (s: OrderStatus) => TERMINAL_STATUSES.has(s);
    return this.store.sorted().filter((o) => f === 'all' || (f === 'done' ? isDone(o.status) : !isDone(o.status)));
  });

  protected setFilter(filter: Filter) {
    void this.router.navigate([], { queryParams: { filter: filter === 'all' ? null : filter }, queryParamsHandling: 'merge' });
  }
}
