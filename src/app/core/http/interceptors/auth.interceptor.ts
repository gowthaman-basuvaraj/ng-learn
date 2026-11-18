import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { SKIP_AUTH } from '../http-context';

const withBearer = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * Attaches the bearer token and transparently recovers from expired tokens.
 *
 * The classic bug this avoids: the token expires, 5 requests are in flight, all 5 get 401,
 * and all 5 call /refresh. With rotating refresh tokens, the 2nd..5th refresh calls FAIL
 * (the token was already used) and the user gets logged out at random.
 *
 * Here:
 *  1. If a refresh is already running, new requests wait for it instead of sending a stale token.
 *  2. On 401, if the token we sent is no longer current (someone else refreshed while we were
 *     in flight), we just retry with the current token. No second refresh.
 *  3. Otherwise we join the single shared refresh (AuthService.refresh is single-flight),
 *     then replay the request exactly once.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_AUTH)) return next(req);
  const auth = inject(AuthService);

  return auth.currentToken().pipe(
    switchMap((sentToken) =>
      next(withBearer(req, sentToken)).pipe(
        catchError((err: unknown) => {
          if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.isAuthenticated()) {
            return throwError(() => err);
          }
          const current = auth.accessToken();
          const fresh$ = current && current !== sentToken ? auth.currentToken() : auth.refresh();
          return fresh$.pipe(switchMap((token) => next(withBearer(req, token))));
        }),
      ),
    ),
  );
};
