import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConnectionStatus } from '../core/realtime/connection';
import { EventStream } from '../core/realtime/event-stream.service';
import { MarketSocket } from '../core/realtime/market-socket.service';

@Component({
  selector: 'app-connection-badges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [attr.data-status]="socket.status()" [title]="'WebSocket: ' + socket.status()">
      <i></i> WS {{ label(socket.status()) }}
    </span>
    <span class="badge" [attr.data-status]="events.status()" [title]="'Server-Sent Events: ' + events.status()">
      <i></i> SSE {{ label(events.status()) }}
    </span>
  `,
  styles: `
    :host { display: flex; gap: 6px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
    i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
    [data-status='open'] i { background: var(--up); box-shadow: 0 0 6px var(--up); }
    [data-status='connecting'] i, [data-status='reconnecting'] i { background: var(--warn); animation: pulse 1s infinite; }
    [data-status='closed'] i { background: var(--down); }
    @keyframes pulse { 50% { opacity: .3; } }
  `,
})
export class ConnectionBadges {
  protected readonly socket = inject(MarketSocket);
  protected readonly events = inject(EventStream);

  protected label(s: ConnectionStatus) {
    return s === 'open' ? 'live' : s;
  }
}
