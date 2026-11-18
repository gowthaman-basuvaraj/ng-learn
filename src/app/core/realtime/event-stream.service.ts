import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, filter, map, share, switchMap } from 'rxjs';
import { NewsItem, Order } from '../../domain/models';
import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app-config';
import { ConnectionStatus, backoffDelay } from './connection';

/** The contract between server and client: event name -> payload type. */
export interface ServerEventMap {
  order: Order;
  news: NewsItem;
}
type EventName = keyof ServerEventMap;
type ServerEvent = { [K in EventName]: { type: K; data: ServerEventMap[K] } }[EventName];
const EVENT_NAMES: EventName[] = ['order', 'news'];

/**
 * Server-Sent Events wrapped as a typed, shared, auth-aware Observable.
 *
 * Why SSE here and WebSocket for prices? SSE is one-way, plain HTTP (proxies and HTTP/2 are fine
 * with it), and has resume built in via Last-Event-ID. That's ideal for "tell me when my order
 * changes". Prices need dynamic subscribe/unsubscribe from the client, which is a two-way
 * protocol, so WebSocket.
 *
 * Lifecycle:
 *  - Connects only while authenticated (switchMap over the auth signal), and closes on logout.
 *  - ONE EventSource no matter how many stores call `on()`: share() refcounts it.
 *  - The browser auto-reconnects on network blips and sends Last-Event-ID, so the server replays
 *    whatever we missed. If the browser gives up (readyState CLOSED, e.g. a 401 because the token
 *    in the URL expired), we take over: refresh the token if the failure happened before the
 *    stream opened, then reconnect with backoff, passing lastEventId so no events are lost.
 */
@Injectable({ providedIn: 'root' })
export class EventStream {
  private readonly auth = inject(AuthService);
  private readonly url = inject(APP_CONFIG).sseUrl;

  private readonly _status = signal<ConnectionStatus>('idle');
  readonly status = this._status.asReadonly();
  readonly lastEventId = signal<string>('');

  private readonly raw$ = new Observable<ServerEvent>((subscriber) => {
    let es: EventSource | null = null;
    let attempt = 0;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      const token = this.auth.accessToken();
      if (!token) return;
      this._status.set(attempt > 0 ? 'reconnecting' : 'connecting');
      const params = new URLSearchParams({ access_token: token });
      if (this.lastEventId()) params.set('lastEventId', this.lastEventId());
      es = new EventSource(`${this.url}?${params}`);
      opened = false;

      es.onopen = () => {
        opened = true;
        attempt = 0;
        this._status.set('open');
      };
      for (const type of EVENT_NAMES) {
        es.addEventListener(type, (e: MessageEvent<string>) => {
          if (e.lastEventId) this.lastEventId.set(e.lastEventId);
          subscriber.next({ type, data: JSON.parse(e.data) } as ServerEvent);
        });
      }
      es.onerror = () => {
        if (!es) return;
        if (es.readyState === EventSource.CONNECTING) {
          // The browser is retrying on its own (and will send Last-Event-ID).
          opened = false;
          this._status.set('reconnecting');
          return;
        }
        // CLOSED: the browser gave up. We own reconnection from here.
        es.close();
        es = null;
        this._status.set('reconnecting');
        const delay = backoffDelay(attempt++);
        const reopen = () => (timer = setTimeout(open, delay));
        if (!opened) {
          // Never got a 200: most likely the token in the URL is stale.
          this.auth.refresh().subscribe({ next: reopen, error: () => this.auth.isAuthenticated() && reopen() });
        } else {
          reopen();
        }
      };
    };

    open();
    return () => {
      clearTimeout(timer);
      es?.close();
      this._status.set('idle');
    };
  });

  private readonly events$: Observable<ServerEvent> = toObservable(this.auth.isAuthenticated).pipe(
    switchMap((authed) => (authed ? this.raw$ : EMPTY)),
    share(),
  );

  on<K extends EventName>(type: K): Observable<ServerEventMap[K]> {
    return this.events$.pipe(
      filter((e) => e.type === type),
      map((e) => e.data as ServerEventMap[K]),
    );
  }
}
