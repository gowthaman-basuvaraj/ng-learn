import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../notifications/toast.service';
import { ApiError } from '../api-error';
import { SILENT_ERRORS } from '../http-context';

/**
 * Normalises every failure into ApiError and decides whether the user should be told about it.
 *
 * Not toasted:
 *  - 401: the auth interceptor owns that flow (refresh, or redirect to login)
 *  - 422: validation errors belong next to the form field, not in a toast
 *  - requests flagged SILENT_ERRORS: the caller renders the error itself
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toasts = inject(ToastService);
  return next(req).pipe(
    catchError((raw: unknown) => {
      const error = ApiError.from(raw);
      const handledElsewhere = error.status === 401 || error.status === 422 || req.context.get(SILENT_ERRORS);
      if (!handledElsewhere) {
        toasts.error(error.message, { title: `${req.method} ${new URL(req.url, location.origin).pathname} failed` });
      }
      return throwError(() => error);
    }),
  );
};
