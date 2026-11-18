import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAppConfig } from '../core/config/app-config';
import { Order } from '../domain/models';
import { OrdersStore } from './orders.store';

const base: Order = {
  id: 'o1', symbol: 'AAPL', side: 'BUY', qty: 10, type: 'MARKET', limitPrice: null,
  status: 'PENDING', fillPrice: null, createdAt: 1, updatedAt: 100,
};

describe('OrdersStore', () => {
  let store: InstanceType<typeof OrdersStore>;
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideAppConfig(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(OrdersStore);
    backend = TestBed.inject(HttpTestingController);
  });

  it('keeps the newest version when SSE and HTTP responses race', () => {
    store.upsertIfNewer({ ...base, status: 'FILLED', fillPrice: 228, updatedAt: 200 }); // SSE arrived first
    store.upsertIfNewer({ ...base, status: 'PENDING', updatedAt: 100 }); // stale POST response, late
    expect(store.orderEntityMap()['o1'].status).toBe('FILLED');
  });

  it('shows an optimistic SUBMITTING order, then swaps in the server version', async () => {
    const promise = store.place({ symbol: 'AAPL', side: 'BUY', qty: 10, type: 'MARKET', limitPrice: null });
    expect(store.sorted()[0].status).toBe('SUBMITTING');
    expect(store.submitting()).toBe(true);

    backend.expectOne('/api/orders').flush(base);
    await promise;

    expect(store.sorted().map((o) => o.id)).toEqual(['o1']);
    expect(store.submitting()).toBe(false);
  });

  it('rolls the optimistic order back when the server rejects it', async () => {
    const promise = store.place({ symbol: 'AAPL', side: 'SELL', qty: 999, type: 'MARKET', limitPrice: null });
    backend.expectOne('/api/orders').flush({ code: 'VALIDATION_FAILED' }, { status: 422, statusText: 'Unprocessable' });

    await expect(promise).rejects.toBeTruthy();
    expect(store.orderEntities()).toHaveLength(0);
  });
});
