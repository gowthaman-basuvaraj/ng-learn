import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { EventStream } from '../core/realtime/event-stream.service';
import { NewsItem } from '../domain/models';
import { onSessionChange } from './with-session-lifecycle';

const MAX_ITEMS = 30;

export const NewsStore = signalStore(
  { providedIn: 'root' },
  withState({ items: [] as NewsItem[], lastSeenAt: Date.now() }),
  withComputed(({ items, lastSeenAt }) => ({
    unread: computed(() => items().filter((n) => n.ts > lastSeenAt()).length),
  })),
  withMethods((store) => ({
    markAllSeen() {
      patchState(store, { lastSeenAt: Date.now() });
    },
    forSymbol(symbol: string) {
      return store.items().filter((n) => n.symbol === symbol);
    },
    onSessionStart() {},
    onSessionEnd() {
      patchState(store, { items: [], lastSeenAt: Date.now() });
    },
  })),
  withHooks({
    onInit(store) {
      onSessionChange({ start: () => store.onSessionStart(), end: () => store.onSessionEnd() });
      inject(EventStream)
        .on('news')
        .pipe(takeUntilDestroyed())
        .subscribe((item) => patchState(store, (s) => ({ items: [item, ...s.items].slice(0, MAX_ITEMS) })));
    },
  }),
);
