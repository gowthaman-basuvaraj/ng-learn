import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { NewsStore } from '../state/news.store';
import { OrdersStore } from '../state/orders.store';
import { ConnectionBadges } from './connection-badges';
import { NewsPanel } from './news-panel';
import { TickerTape } from './ticker-tape';

/**
 * Authenticated layout. Every child route renders inside <router-outlet>.
 * Injecting the stores here is what "boots" the realtime layer for the session: they subscribe
 * to SSE in their onInit hooks.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TickerTape, ConnectionBadges, NewsPanel],
  template: `
    <header class="topbar">
      <a routerLink="/markets" class="brand">◆ Market Desk</a>
      <nav class="nav">
        <a routerLink="/markets" routerLinkActive="active">Markets</a>
        <a routerLink="/portfolio" routerLinkActive="active">Portfolio</a>
        <a routerLink="/orders" routerLinkActive="active">
          Orders
          @if (orders.openCount() > 0) { <span class="pill">{{ orders.openCount() }}</span> }
        </a>
        <a routerLink="/lab" routerLinkActive="active">Lab</a>
      </nav>
      <app-ticker-tape class="grow" />
      <app-connection-badges />
      <button type="button" class="btn btn--ghost bell" (click)="newsOpen.set(!newsOpen())" [attr.aria-expanded]="newsOpen()">
        News
        @if (news.unread() > 0) { <span class="pill pill--alert">{{ news.unread() }}</span> }
      </button>
      <span class="muted user">{{ auth.user()?.displayName }}</span>
      <button type="button" class="btn btn--ghost" (click)="auth.logout()">Sign out</button>
    </header>

    <app-news-panel [(open)]="newsOpen" />

    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; }
    .topbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 12px; padding: 8px 16px;
      background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--border); }
    .brand { font-weight: 700; color: var(--text); text-decoration: none; white-space: nowrap; }
    .nav { display: flex; gap: 2px; }
    .nav a { padding: 6px 10px; border-radius: 6px; color: var(--muted); text-decoration: none; font-size: 14px; display: inline-flex; gap: 6px; align-items: center; }
    .nav a:hover { color: var(--text); }
    .nav a.active { color: var(--text); background: var(--surface-2); }
    .grow { flex: 1; min-width: 0; }
    .user { font-size: 13px; white-space: nowrap; }
    .content { padding: 20px 16px; max-width: 1280px; margin: 0 auto; }
    @media (max-width: 900px) { .topbar { flex-wrap: wrap; } .grow { order: 10; flex-basis: 100%; } .user { display: none; } }
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly orders = inject(OrdersStore);
  protected readonly news = inject(NewsStore);
  protected readonly newsOpen = signal(false);

  constructor() {
    effect(() => {
      if (this.newsOpen()) this.news.markAllSeen();
    });
  }
}
