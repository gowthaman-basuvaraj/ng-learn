import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-outlet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class]="'toast--' + t.kind" role="status">
          <div class="toast__body">
            @if (t.title) { <strong>{{ t.title }}</strong> }
            <span>{{ t.message }}</span>
          </div>
          @if (t.count > 1) { <span class="toast__count">×{{ t.count }}</span> }
          <button type="button" class="toast__close" (click)="toasts.dismiss(t.id)" aria-label="Dismiss">×</button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 100; width: min(380px, calc(100vw - 32px)); }
    .toast { display: flex; gap: 10px; align-items: start; padding: 10px 12px; border-radius: 8px;
      background: var(--surface-2); border-left: 4px solid var(--muted); box-shadow: 0 6px 24px #0006; animation: in .18s ease-out; }
    .toast--success { border-color: var(--up); } .toast--error { border-color: var(--down); }
    .toast--warning { border-color: var(--warn); } .toast--info { border-color: var(--accent); }
    .toast__body { display: grid; gap: 2px; flex: 1; font-size: 13px; }
    .toast__count { font-size: 12px; color: var(--muted); }
    .toast__close { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 16px; }
    @keyframes in { from { transform: translateY(8px); opacity: 0; } }
  `,
})
export class ToastOutlet {
  protected readonly toasts = inject(ToastService);
}
