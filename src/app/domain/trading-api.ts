import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from '../core/config/app-config';
import { withContext } from '../core/http/http-context';
import { Order, OrderDraft, Portfolio } from './models';

@Injectable({ providedIn: 'root' })
export class TradingApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  portfolio() {
    return this.http.get<Portfolio>(`${this.base}/portfolio`);
  }
  orders() {
    return this.http.get<Order[]>(`${this.base}/orders`);
  }
  /** 422s are rendered next to the form fields, so the error interceptor skips toasting them. */
  placeOrder(draft: OrderDraft) {
    return this.http.post<Order>(`${this.base}/orders`, draft);
  }
  cancelOrder(id: string) {
    return this.http.delete<Order>(`${this.base}/orders/${encodeURIComponent(id)}`, { context: withContext({ retry: 0 }) });
  }
}
