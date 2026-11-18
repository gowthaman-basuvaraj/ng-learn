import { ResolveFn, Routes } from '@angular/router';
import { unsavedChangesGuard } from './instrument-detail/unsaved-changes.guard';

const symbolTitle: ResolveFn<string> = (route) => (route.paramMap.get('symbol') ?? '').toUpperCase();

/** Default export, so the parent can write `loadChildren: () => import('./markets.routes')`. */
export default [
  {
    path: '',
    title: 'Markets',
    loadComponent: () => import('./watchlist/watchlist-page').then((m) => m.WatchlistPage),
  },
  {
    path: ':symbol',
    title: symbolTitle,
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./instrument-detail/instrument-detail-page').then((m) => m.InstrumentDetailPage),
  },
] satisfies Routes;
