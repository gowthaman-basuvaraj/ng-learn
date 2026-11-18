import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoadingService } from './core/http/loading.service';
import { ToastOutlet } from './core/notifications/toast-outlet';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastOutlet],
  template: `
    <div class="progress" [class.progress--active]="loading.busy()" role="progressbar" [attr.aria-busy]="loading.busy()"></div>
    <router-outlet />
    <app-toast-outlet />
  `,
  styles: `
    .progress { position: fixed; inset: 0 0 auto 0; height: 2px; z-index: 200; pointer-events: none;
      background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 50% 100%;
      opacity: 0; transition: opacity .2s; }
    /* the delay avoids flashing the bar for requests that finish in < 150 ms */
    .progress--active { opacity: 1; transition-delay: .15s; animation: slide 1s linear infinite; }
    @keyframes slide { from { background-position: -50% 0; } to { background-position: 150% 0; } }
  `,
})
export class App {
  protected readonly loading = inject(LoadingService);
}
