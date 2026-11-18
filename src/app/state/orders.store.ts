import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, type, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { addEntity, entityConfig, removeAllEntities, removeEntity, setAllEntities, setEntity, withEntities } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { firstValueFrom, mergeMap, pipe, switchMap, tap } from 'rxjs';
import { ToastService } from '../core/notifications/toast.service';
import { EventStream } from '../core/realtime/event-stream.service';
import { Order, OrderDraft, TERMINAL_STATUSES } from '../domain/models';
import { TradingApi } from '../domain/trading-api';
import { LoadStatus, onSessionChange } from './with-session-lifecycle';

const orderConfig = entityConfig({ entity: type<Order>(), collection: 'order' });

interface OrdersState {
  status: LoadStatus;
  submitting: boolean;
}
const initialState: OrdersState = { status: 'idle', submitting: false };

/**
 * Orders arrive from THREE places that can race each other:
 *   1. GET /orders                (initial snapshot)
 *   2. POST /orders response      (our own order, acknowledged)
 *   3. SSE 'order' events          (status transitions, which may arrive BEFORE the POST response)
 *
 * Every write goes through `upsertIfNewer`, which keeps whichever version has the greater
 * updatedAt. Order of arrival stops mattering, and that's the whole trick.
 */
export const OrdersStore = signalStore(
  { providedIn: 'root' },
  withEntities(orderConfig),
  withState(initialState),
  withComputed(({ orderEntities }) => ({
    sorted: computed(() => [...orderEntities()].sort((a, b) => b.createdAt - a.createdAt)),
    openCount: computed(() => orderEntities().filter((o) => !TERMINAL_STATUSES.has(o.status)).length),
  })),
  withMethods((store, api = inject(TradingApi)) => {
    const upsertIfNewer = (order: Order) => {
      const existing = store.orderEntityMap()[order.id];
      if (existing && existing.updatedAt > order.updatedAt) return;
      patchState(store, setEntity(order, orderConfig));
    };

    const load = rxMethod<void>(
      pipe(
        tap(() => patchState(store, { status: 'loading' })),
        switchMap(() =>
          api.orders().pipe(
            tapResponse({
              next: (orders) => patchState(store, setAllEntities(orders, orderConfig), { status: 'loaded' }),
              error: () => patchState(store, { status: 'error' }),
            }),
          ),
        ),
      ),
    );

    return {
      upsertIfNewer,
      load,

      /**
       * Optimistic: the order shows up instantly as SUBMITTING, then gets swapped for the server's
       * version, or removed if the server rejects it. It returns a Promise because the caller (a
       * form) needs the outcome to map field errors. Fire-and-forget methods use rxMethod instead.
       */
      async place(draft: OrderDraft): Promise<Order> {
        const tempId = `tmp_${crypto.randomUUID()}`;
        const now = Date.now();
        const optimistic: Order = { ...draft, id: tempId, status: 'SUBMITTING', fillPrice: null, createdAt: now, updatedAt: now };
        patchState(store, addEntity(optimistic, orderConfig), { submitting: true });
        try {
          const order = await firstValueFrom(api.placeOrder(draft));
          patchState(store, removeEntity(tempId, orderConfig));
          upsertIfNewer(order);
          return order;
        } catch (err) {
          patchState(store, removeEntity(tempId, orderConfig)); // roll back
          throw err;
        } finally {
          patchState(store, { submitting: false });
        }
      },

      /** mergeMap: cancelling two different orders quickly must not abort the first request. */
      cancel: rxMethod<string>(
        pipe(mergeMap((id) => api.cancelOrder(id).pipe(tapResponse({ next: upsertIfNewer, error: () => undefined })))),
      ),

      onSessionStart() {
        load();
      },
      onSessionEnd() {
        patchState(store, removeAllEntities(orderConfig), initialState);
      },
    };
  }),
  withHooks({
    onInit(store) {
      onSessionChange({ start: () => store.onSessionStart(), end: () => store.onSessionEnd() });
      const toasts = inject(ToastService);
      inject(EventStream)
        .on('order')
        .pipe(takeUntilDestroyed())
        .subscribe((order) => {
          const before = store.orderEntityMap()[order.id]?.status;
          store.upsertIfNewer(order);
          if (before === order.status) return;
          const label = `${order.side} ${order.qty} ${order.symbol}`;
          if (order.status === 'FILLED') toasts.success(`${label} filled @ ${order.fillPrice?.toFixed(2)}`, { title: 'Order filled' });
          if (order.status === 'REJECTED') toasts.warning(`${label}: ${order.reason ?? 'rejected'}`, { title: 'Order rejected' });
        });
    },
  }),
);
