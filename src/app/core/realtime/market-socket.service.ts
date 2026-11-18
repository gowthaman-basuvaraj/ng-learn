import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app-config';
import { ConnectionStatus, backoffDelay } from './connection';

export interface Tick {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  ts: number;
}
type ServerMessage =
  | ({ type: 'tick' } & Tick)
  | { type: 'subscribed'; symbols: string[] }
  | { type: 'pong'; ts: number };

const IDLE_CLOSE_MS = 5_000;
const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 25_000;

/**
 * ONE WebSocket for the whole app, multiplexing price subscriptions.
 *
 * Components never touch the socket. They declare interest with `retain(symbols)` (usually via
 * `trackSymbols()`), and the service:
 *   - ref-counts symbols, so 4 components watching AAPL produce ONE server subscription
 *   - batches subscribe/unsubscribe changes into one message per microtask (diff of desired vs sent)
 *   - connects lazily on first interest and closes after a few idle seconds with no interest
 *   - reconnects with backoff, then re-subscribes to whatever is currently wanted
 *   - on close code 4401 (auth), refreshes the token through the SAME single-flight refresh
 *     the HTTP interceptor uses, then reconnects
 *   - heartbeats, to detect half-open connections (laptop sleep, Wi-Fi switch) that never fire onclose
 *
 * Ticks go out on `ticks$`. A store subscribes once and fans them out to every component through signals.
 */
@Injectable({ providedIn: 'root' })
export class MarketSocket {
  private readonly auth = inject(AuthService);
  private readonly url = inject(APP_CONFIG).wsUrl;

  private readonly _status = signal<ConnectionStatus>('idle');
  readonly status = this._status.asReadonly();
  /** What the server confirms we're subscribed to (handy for the Lab page). */
  readonly serverSymbols = signal<string[]>([]);
  readonly reconnects = signal(0);

  private readonly _ticks = new Subject<Tick>();
  readonly ticks$ = this._ticks.asObservable();

  private readonly refCounts = new Map<string, number>();
  private sent = new Set<string>();
  private ws: WebSocket | null = null;
  private attempt = 0;
  private syncScheduled = false;
  private lastMessageAt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Realtime follows auth: logging out tears the connection down.
    effect(() => {
      if (!this.auth.isAuthenticated()) this.disconnect();
    });
    const onOnline = () => this.reconnectNow();
    window.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      this.disconnect();
    });
  }

  /** Declare interest in symbols. Returns a release function (call it once). */
  retain(symbols: readonly string[]): () => void {
    for (const s of symbols) this.refCounts.set(s, (this.refCounts.get(s) ?? 0) + 1);
    this.scheduleSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const s of symbols) {
        const n = (this.refCounts.get(s) ?? 0) - 1;
        if (n <= 0) this.refCounts.delete(s);
        else this.refCounts.set(s, n);
      }
      this.scheduleSync();
    };
  }

  /** For the Lab: kill the connection as if the network dropped. */
  simulateDrop() {
    this.ws?.close(4000, 'simulated drop');
  }

  private scheduleSync() {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      this.sync();
    });
  }

  /** Reconcile desired subscriptions (refCounts) with what the server has (sent). */
  private sync() {
    if (this.refCounts.size === 0) {
      this.scheduleIdleClose();
    } else {
      clearTimeout(this.idleTimer);
      this.ensureConnected();
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return; // onopen will call sync()

    const desired = new Set(this.refCounts.keys());
    const add = [...desired].filter((s) => !this.sent.has(s));
    const remove = [...this.sent].filter((s) => !desired.has(s));
    if (add.length) this.send({ type: 'subscribe', symbols: add });
    if (remove.length) this.send({ type: 'unsubscribe', symbols: remove });
    this.sent = desired;
  }

  private ensureConnected() {
    if (!this.auth.isAuthenticated() || this.reconnectTimer) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    this.connect();
  }

  private connect() {
    const token = this.auth.accessToken();
    if (!token) return;
    this._status.set(this.attempt > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(`${this.url}?access_token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.attempt > 0) this.reconnects.update((n) => n + 1);
      this.attempt = 0;
      this.sent = new Set();
      this.lastMessageAt = Date.now();
      this._status.set('open');
      this.startHeartbeat();
      this.sync(); // re-subscribe to everything currently wanted
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      this.lastMessageAt = Date.now();
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === 'tick') {
        const { type: _ignored, ...tick } = msg;
        this._ticks.next(tick);
      } else if (msg.type === 'subscribed') {
        this.serverSymbols.set(msg.symbols);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return; // a stale socket closing after we already replaced it
      this.ws = null;
      this.sent = new Set();
      this.serverSymbols.set([]);
      this.stopHeartbeat();

      if (this.refCounts.size === 0 || !this.auth.isAuthenticated()) {
        this._status.set('idle');
        return;
      }
      this._status.set('reconnecting');
      if (event.code === 4401) {
        // Token rejected at handshake: refresh (shared with HTTP), then reconnect.
        this.auth.refresh().subscribe({
          next: () => this.scheduleReconnect(),
          error: () => this._status.set('closed'),
        });
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = backoffDelay(this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureConnected();
    }, delay);
  }

  private reconnectNow() {
    if (this._status() !== 'reconnecting') return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ensureConnected();
  }

  private scheduleIdleClose() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.refCounts.size === 0) this.disconnect();
    }, IDLE_CLOSE_MS);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
        this.ws?.close(4000, 'heartbeat timeout'); // onclose -> reconnect
        return;
      }
      this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private disconnect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.idleTimer);
    this.reconnectTimer = undefined;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null; // set first so onclose sees it as stale and doesn't reconnect
    ws?.close(1000, 'client disconnect');
    this.sent = new Set();
    this.attempt = 0;
    this.serverSymbols.set([]);
    this._status.set('idle');
  }
}
