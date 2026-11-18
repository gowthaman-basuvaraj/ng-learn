import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

/**
 * Everything below the shell is lazy loaded: each loadComponent/loadChildren is its own JS chunk.
 * The authenticated area uses canMatch, so an anonymous user never downloads its code.
 */
export const routes: Routes = [
  {
    path: 'login',
    canMatch: [guestGuard],
    title: 'Sign in',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'markets' },
      { path: 'markets', loadChildren: () => import('./features/markets/markets.routes') },
      { path: 'portfolio', title: 'Portfolio', loadComponent: () => import('./features/portfolio/portfolio-page').then((m) => m.PortfolioPage) },
      { path: 'orders', title: 'Orders', loadComponent: () => import('./features/orders/orders-page').then((m) => m.OrdersPage) },
      { path: 'lab', title: 'Lab', loadComponent: () => import('./features/lab/lab-page').then((m) => m.LabPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
