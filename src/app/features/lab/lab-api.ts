import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from '../../core/config/app-config';
import { withContext } from '../../core/http/http-context';

export interface ServerStats {
  hits: Record<string, number>;
  sseClients: number;
  wsClients: number;
}

/** Provided at the Lab page level, not root: nothing outside the Lab needs it. */
@Injectable()
export class LabApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;
  private readonly quiet = withContext({ skipAuth: true, skipLoading: true, silent: true, dedup: false });

  stats() {
    return this.http.get<ServerStats>(`${this.base}/debug/stats`, { context: this.quiet });
  }
  resetStats() {
    return this.http.post<void>(`${this.base}/debug/reset-stats`, null, { context: withContext({ skipAuth: true, skipLoading: true }) });
  }
  slow(dedup: boolean) {
    return this.http.get<{ servedAt: number; hit: number }>(`${this.base}/debug/slow`, { params: { ms: 1200 }, context: withContext({ dedup }) });
  }
  flaky(failures: number) {
    return this.http.get<{ ok: boolean; attempts: number }>(`${this.base}/debug/flaky`, { params: { failures, key: crypto.randomUUID() } });
  }
  expireTokens() {
    return this.http.post<void>(`${this.base}/debug/expire-tokens`, null, { context: withContext({ skipAuth: true }) });
  }
  dropConnections() {
    return this.http.post<void>(`${this.base}/debug/drop-connections`, null, { context: withContext({ skipAuth: true }) });
  }
  me() {
    return this.http.get<unknown>(`${this.base}/me`);
  }
  portfolio() {
    return this.http.get<unknown>(`${this.base}/portfolio`);
  }
  orders() {
    return this.http.get<unknown>(`${this.base}/orders`);
  }
}
