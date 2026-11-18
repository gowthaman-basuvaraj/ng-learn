import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from '../core/config/app-config';
import { Instrument, InstrumentDetail, PricePoint } from './models';

/**
 * Thin, typed API clients: one method per endpoint, no state, no caching.
 * Stores own state. Interceptors own cross-cutting concerns. This class only knows URLs and types.
 */
@Injectable({ providedIn: 'root' })
export class MarketApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  instruments() {
    return this.http.get<Instrument[]>(`${this.base}/instruments`);
  }
  instrument(symbol: string) {
    return this.http.get<InstrumentDetail>(`${this.base}/instruments/${encodeURIComponent(symbol)}`);
  }
  history(symbol: string, points: number) {
    return this.http.get<PricePoint[]>(`${this.base}/instruments/${encodeURIComponent(symbol)}/history`, { params: { points } });
  }
}
