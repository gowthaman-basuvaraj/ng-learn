import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Functional guards (class guards with CanActivate are deprecated in spirit).
 *
 * canMatch rather than canActivate: if the user isn't authenticated, the route doesn't MATCH,
 * so its lazy chunk is never even downloaded.
 */
export const authGuard: CanMatchFn = (_route, segments) => {
  if (inject(AuthService).isAuthenticated()) return true;
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl } });
};

export const guestGuard: CanMatchFn = () =>
  inject(AuthService).isAuthenticated() ? inject(Router).createUrlTree(['/markets']) : true;
