import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { PreloadAllModules, TitleStrategy, provideRouter, withComponentInputBinding, withPreloading, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';
import { provideAppConfig } from './core/config/app-config';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { appInterceptors } from './core/http/interceptors';
import { AppTitleStrategy } from './core/title-strategy';

/**
 * The application's root injector, the standalone-era replacement for AppModule.
 * Everything app-wide is wired here, and you can read the app's architecture from this one list.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the default for new v21 apps; stated explicitly so it's visible. Change detection
    // is driven by signals, template events, and the async pipe, NOT by zone.js monkey-patching
    // every setTimeout/Promise.
    provideZonelessChangeDetection(),
    provideAppConfig(),
    provideHttpClient(withFetch(), withInterceptors(appInterceptors)),
    provideRouter(
      routes,
      withComponentInputBinding(), // route params / query params / data -> component input()s
      withPreloading(PreloadAllModules), // lazy chunks download in the background after first paint
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
