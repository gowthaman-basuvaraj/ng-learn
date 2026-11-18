import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ApiError } from '../http/api-error';
import { ToastService } from '../notifications/toast.service';

/**
 * Last line of defence for anything that isn't caught: template errors, thrown errors in
 * subscriptions without an error callback, and, via provideBrowserGlobalErrorListeners(),
 * unhandled promise rejections. This is where you'd report to Sentry/Datadog.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toasts = inject(ToastService);

  handleError(error: unknown): void {
    // HTTP errors were already surfaced by the error interceptor; don't double-toast.
    if (error instanceof ApiError) return;
    console.error('[GlobalErrorHandler]', error);
    this.toasts.error(error instanceof Error ? error.message : 'Something went wrong', { title: 'Unexpected error' });
  }
}
