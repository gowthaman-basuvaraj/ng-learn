import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, defer, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-error';
import { withContext } from '../http/http-context';

export interface User {
  id: string;
  username: string;
  displayName: string;
}
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}
interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
}

const STORAGE_KEY = 'ng-learn.session';

/**
 * A hand-rolled signal store. For this much state a library would be ceremony:
 * a private writable signal, public read-only projections, and methods that are the
 * ONLY way to change state.
 *
 * Note on storage: a real app should keep the refresh token in an httpOnly cookie, out of
 * JS's reach. sessionStorage keeps this demo self-contained (and is per-tab, unlike localStorage).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;

  private readonly session = signal<Session | null>(readSession());
  private refreshInFlight$: Observable<string> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly accessToken = computed(() => this.session()?.accessToken ?? null);
  readonly expiresAt = computed(() => this.session()?.expiresAt ?? null);
  /** Lets the Lab page show the single-flight refresh happening. */
  readonly refreshCount = signal(0);

  constructor() {
    // Persist as a side effect of state changes, not sprinkled through every method.
    effect(() => {
      const s = this.session();
      if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(STORAGE_KEY);
    });
  }

  login(username: string, password: string): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.api}/auth/login`, { username, password }, { context: withContext({ skipAuth: true, silent: true, retry: 0 }) })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.user),
      );
  }

  /**
   * Single-flight refresh: every caller during a refresh shares the SAME request.
   * shareReplay(1) with refCount:false means a caller arriving a moment after it completes
   * (but still holding the reference) still gets the token.
   */
  refresh(): Observable<string> {
    if (this.refreshInFlight$) return this.refreshInFlight$;
    const refreshToken = this.session()?.refreshToken;
    if (!refreshToken) return throwError(() => new Error('No session'));

    this.refreshCount.update((n) => n + 1);
    this.refreshInFlight$ = this.http
      .post<AuthResponse>(`${this.api}/auth/refresh`, { refreshToken }, { context: withContext({ skipAuth: true, silent: true, retry: 0, dedup: false }) })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.accessToken),
        catchError((err: unknown) => {
          // Only a definitive "no" from the server ends the session. A network blip during
          // refresh must NOT log the user out; the caller can try again later.
          const status = ApiError.from(err).status;
          if (status === 400 || status === 401) this.logout('expired');
          return throwError(() => err);
        }),
        finalize(() => (this.refreshInFlight$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  /** The token to use *right now*: waits for an in-progress refresh instead of sending a stale one. */
  currentToken(): Observable<string | null> {
    return defer(() => this.refreshInFlight$ ?? of(this.accessToken()));
  }

  logout(reason?: 'expired') {
    this.session.set(null);
    this.refreshInFlight$ = null;
    const returnUrl = this.router.url.startsWith('/login') ? undefined : this.router.url;
    void this.router.navigate(['/login'], { queryParams: { reason, returnUrl } });
  }

  private setSession(res: AuthResponse) {
    this.session.set({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresAt: Date.now() + res.expiresIn * 1000,
      user: res.user,
    });
  }
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
