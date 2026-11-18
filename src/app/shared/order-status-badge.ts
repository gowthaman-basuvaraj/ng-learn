import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { OrderStatus } from '../domain/models';

@Component({
  selector: 'app-order-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()', role: 'status' },
  template: `{{ status() === 'SUBMITTING' ? 'sending…' : status().toLowerCase() }}`,
  styles: `
    :host { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); text-transform: capitalize; }
    :host([data-status='FILLED']) { color: var(--up); background: var(--up-bg); }
    :host([data-status='REJECTED']) { color: var(--down); background: var(--down-bg); }
    :host([data-status='WORKING']), :host([data-status='PENDING']) { color: var(--warn); }
    :host([data-status='SUBMITTING']) { font-style: italic; }
  `,
})
export class OrderStatusBadge {
  readonly status = input.required<OrderStatus>();
}
