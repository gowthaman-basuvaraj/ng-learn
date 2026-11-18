import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError } from '../../core/http/api-error';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <div class="wrap">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>◆ Market Desk</h1>
        @if (reason() === 'expired') {
          <p class="notice">Your session expired. Please sign in again.</p>
        }
        <label>
          Username
          <input formControlName="username" autocomplete="username" />
        </label>
        <label>
          Password
          <input formControlName="password" type="password" autocomplete="current-password" />
        </label>
        @if (error(); as e) {
          <p class="error" role="alert">{{ e }}</p>
        }
        <button class="btn btn--primary" type="submit" [disabled]="form.invalid || pending()">
          {{ pending() ? 'Signing in…' : 'Sign in' }}
        </button>
        <p class="muted hint">demo / demo · the mock API must be running (<code>npm run api</code>)</p>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
    .card { width: min(360px, 100%); display: grid; gap: 14px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
    .notice { background: color-mix(in srgb, var(--warn) 15%, transparent); padding: 8px 10px; border-radius: 6px; margin: 0; font-size: 13px; }
    .hint { font-size: 12px; margin: 0; }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Query params bound straight to inputs via withComponentInputBinding()
  readonly returnUrl = input<string>();
  readonly reason = input<string>();

  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  // NonNullableFormBuilder: control values are `string`, never `string | null`, even after reset().
  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['demo', Validators.required],
    password: ['demo', Validators.required],
  });

  protected submit() {
    if (this.form.invalid) return;
    const { username, password } = this.form.getRawValue();
    this.pending.set(true);
    this.error.set(null);
    this.auth.login(username, password).subscribe({
      next: () => void this.router.navigateByUrl(this.returnUrl() || '/markets'),
      error: (e: unknown) => {
        this.error.set(ApiError.from(e).message);
        this.pending.set(false);
      },
    });
  }
}
