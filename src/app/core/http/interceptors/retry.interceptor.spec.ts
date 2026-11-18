import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideAppConfig } from '../../config/app-config';
import { idempotencyInterceptor } from './idempotency.interceptor';
import { retryInterceptor } from './retry.interceptor';

const unavailable = { status: 503, statusText: 'Unavailable' };

describe('retryInterceptor (+ idempotency ordering)', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideAppConfig({ retry: { maxAttempts: 2, baseDelayMs: 10 } }),
        provideHttpClient(withInterceptors([idempotencyInterceptor, retryInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    vi.useRealTimers();
  });

  it('retries transient GET failures with backoff and surfaces only the final success', async () => {
    let result: unknown;
    http.get('/api/x').subscribe((r) => (result = r));

    backend.expectOne('/api/x').flush(null, unavailable);
    await vi.advanceTimersByTimeAsync(100);
    backend.expectOne('/api/x').flush(null, unavailable);
    await vi.advanceTimersByTimeAsync(100);
    backend.expectOne('/api/x').flush({ ok: true });

    expect(result).toEqual({ ok: true });
  });

  it('gives up after maxAttempts and propagates the error', async () => {
    let error: unknown;
    http.get('/api/x').subscribe({ error: (e) => (error = e) });
    for (let i = 0; i < 3; i++) {
      backend.expectOne('/api/x').flush(null, unavailable);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(error).toBeTruthy();
  });

  it('does not retry client errors (4xx)', () => {
    let error: unknown;
    http.get('/api/x').subscribe({ error: (e) => (error = e) });
    backend.expectOne('/api/x').flush(null, { status: 404, statusText: 'Not Found' });
    expect(error).toBeTruthy();
  });

  it('retries a POST because it carries an Idempotency-Key, and reuses the SAME key', async () => {
    http.post('/api/orders', {}).subscribe();
    const first = backend.expectOne('/api/orders');
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();

    first.flush(null, unavailable);
    await vi.advanceTimersByTimeAsync(100);
    const second = backend.expectOne('/api/orders');
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush({});
  });
});
