import { ChangeDetectionStrategy, Component, inject, model } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NewsStore } from '../state/news.store';

/**
 * `model()` = two-way bindable signal input. The parent writes `[(open)]="newsOpen"`:
 * Angular's equivalent of Vue's v-model / defineModel.
 */
@Component({
  selector: 'app-news-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  template: `
    @if (open()) {
      <aside class="panel" role="dialog" aria-label="Market news">
        <header>
          <strong>News</strong>
          <button type="button" class="btn btn--ghost" (click)="open.set(false)">Close</button>
        </header>
        @for (n of news.items(); track n.id) {
          <a class="item" [attr.data-severity]="n.severity" [routerLink]="['/markets', n.symbol]" (click)="open.set(false)">
            <span class="sym">{{ n.symbol }}</span>
            <span>{{ n.headline }}</span>
            <time class="muted">{{ n.ts | date: 'mediumTime' }}</time>
          </a>
        } @empty {
          <p class="muted">No news yet. Headlines stream in over SSE every ~12s.</p>
        }
      </aside>
    }
  `,
  styles: `
    .panel { position: fixed; top: 56px; right: 12px; width: min(380px, calc(100vw - 24px)); max-height: 70vh; overflow: auto; z-index: 50;
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: 0 12px 40px #0008; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .item { display: grid; grid-template-columns: 56px 1fr; gap: 2px 8px; padding: 8px; border-radius: 6px; color: inherit; text-decoration: none; border-left: 3px solid var(--accent); margin-bottom: 4px; }
    .item:hover { background: var(--surface-2); }
    .item[data-severity='warning'] { border-color: var(--warn); }
    .item[data-severity='critical'] { border-color: var(--down); }
    .item time { grid-column: 2; font-size: 11px; }
    .sym { font-weight: 600; }
  `,
})
export class NewsPanel {
  readonly open = model(false);
  protected readonly news = inject(NewsStore);
}
