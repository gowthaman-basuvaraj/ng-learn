import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { provideAppConfig } from '../../config/app-config';
import { authInterceptor } from './auth.interceptor';

const user = { id: 'u1', username: 'demo', displayName: 'Demo' };
const tokens = (n: number) => ({ accessToken: `at${n}`, refreshToken: `rt${n}`, expiresIn: 60, user });
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor + AuthService.refresh (single flight)', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        provideAppConfig(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);

    auth.login('demo', 'demo').subscribe();
    backend.expectOne('/api/auth/login').flush(tokens(1));
  });

  afterEach(() => backend.verify());

  it('attaches the bearer token', () => {
    http.get('/api/me').subscribe();
    expect(backend.expectOne('/api/me').request.headers.get('Authorization')).toBe('Bearer at1');
  });

  it('does not attach a token to login/refresh calls (SKIP_AUTH)', () => {
    auth.refresh().subscribe();
    const req = backend.expectOne('/api/auth/refresh');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(tokens(2));
  });

  it('refreshes ONCE for many concurrent 401s, then replays every request with the new token', () => {
    const urls = ['/api/a', '/api/b', '/api/c'];
    const results: unknown[] = [];
    urls.forEach((u) => http.get(u).subscribe((r) => results.push(r)));

    urls.forEach((u) => backend.expectOne(u).flush({ code: 'TOKEN_EXPIRED' }, unauthorized));

    const refresh = backend.expectOne('/api/auth/refresh'); // exactly one
    expect(refresh.request.body).toEqual({ refreshToken: 'rt1' });
    refresh.flush(tokens(2));

    urls.forEach((u) => {
      const replay = backend.expectOne(u);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer at2');
      replay.flush({ u });
    });
    expect(results).toHaveLength(3);
    expect(auth.refreshCount()).toBe(1);
  });

  it('requests that start DURING a refresh wait for it instead of sending the stale token', () => {
    auth.refresh().subscribe();
    http.get('/api/late').subscribe();
    backend.expectNone('/api/late'); // parked behind the refresh

    backend.expectOne('/api/auth/refresh').flush(tokens(2));
    expect(backend.expectOne('/api/late').request.headers.get('Authorization')).toBe('Bearer at2');
  });

  it('a 401 for a token that was ALREADY rotated retries without another refresh', () => {
    http.get('/api/slow').subscribe(); // sent with at1
    const slow = backend.expectOne('/api/slow');

    auth.refresh().subscribe(); // someone else refreshes meanwhile
    backend.expectOne('/api/auth/refresh').flush(tokens(2));

    slow.flush({}, unauthorized); // at1 is now stale
    backend.expectNone('/api/auth/refresh');
    expect(backend.expectOne('/api/slow').request.headers.get('Authorization')).toBe('Bearer at2');
  });

  it('logs out when the refresh token itself is rejected', () => {
    let failed = false;
    http.get('/api/a').subscribe({ error: () => (failed = true) });
    backend.expectOne('/api/a').flush({}, unauthorized);
    backend.expectOne('/api/auth/refresh').flush({ code: 'REFRESH_INVALID' }, unauthorized);

    expect(failed).toBe(true);
    expect(auth.isAuthenticated()).toBe(false);
  });
});
