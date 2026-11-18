import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { withContext } from '../http-context';
import { dedupInterceptor } from './dedup.interceptor';

describe('dedupInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([dedupInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('collapses concurrent identical GETs into a single request', () => {
    const results: unknown[] = [];
    for (let i = 0; i < 3; i++) http.get('/api/x').subscribe((r) => results.push(r));

    backend.expectOne('/api/x').flush({ ok: 1 }); // expectOne fails if there are 0 or 2+ requests
    expect(results).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
  });

  it('is not a cache: once settled, the next call hits the network again', () => {
    http.get('/api/x').subscribe();
    backend.expectOne('/api/x').flush({});
    http.get('/api/x').subscribe();
    backend.expectOne('/api/x').flush({});
  });

  it('treats different query params as different requests', () => {
    http.get('/api/x', { params: { a: 1 } }).subscribe();
    http.get('/api/x', { params: { a: 2 } }).subscribe();
    expect(backend.match((r) => r.url === '/api/x')).toHaveLength(2);
  });

  it('can be opted out per request via HttpContext', () => {
    http.get('/api/x', { context: withContext({ dedup: false }) }).subscribe();
    http.get('/api/x', { context: withContext({ dedup: false }) }).subscribe();
    expect(backend.match('/api/x')).toHaveLength(2);
  });

  it('never dedups writes', () => {
    http.post('/api/x', {}).subscribe();
    http.post('/api/x', {}).subscribe();
    expect(backend.match('/api/x')).toHaveLength(2);
  });

  it('keeps the shared request alive when only one subscriber unsubscribes', () => {
    let received: unknown;
    const first = http.get('/api/x').subscribe();
    http.get('/api/x').subscribe((r) => (received = r));
    first.unsubscribe();

    const req = backend.expectOne('/api/x');
    expect(req.cancelled).toBe(false);
    req.flush({ v: 1 });
    expect(received).toEqual({ v: 1 });
  });

  it('cancels the underlying request when every subscriber unsubscribes', () => {
    const a = http.get('/api/x').subscribe();
    const b = http.get('/api/x').subscribe();
    a.unsubscribe();
    b.unsubscribe();
    expect(backend.expectOne('/api/x').cancelled).toBe(true);
  });
});
