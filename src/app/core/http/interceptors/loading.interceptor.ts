import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { defer, finalize } from 'rxjs';
import { SKIP_LOADING } from '../http-context';
import { LoadingService } from '../loading.service';

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_LOADING)) return next(req);
  const loading = inject(LoadingService);
  // `defer` so the counter moves on *subscribe*, not when the interceptor function is called.
  // finalize covers success, error AND cancellation (unsubscribe), so the counter can't leak.
  return defer(() => {
    loading.start();
    return next(req).pipe(finalize(() => loading.stop()));
  });
};
