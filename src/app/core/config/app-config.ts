import { InjectionToken, makeEnvironmentProviders } from '@angular/core';

/**
 * Typed runtime config delivered through DI rather than imported as a module-level constant.
 *
 * Why: anything injected can be swapped per environment, per test, or per lazy-loaded
 * subtree without touching the consumers. (React analogue: a Context with a default value.)
 */
export interface AppConfig {
  apiBaseUrl: string;
  /** Absolute ws:// URL is derived at runtime so it works behind the dev proxy and in prod. */
  wsUrl: string;
  sseUrl: string;
  retry: { maxAttempts: number; baseDelayMs: number };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

export function provideAppConfig(overrides: Partial<AppConfig> = {}) {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const config: AppConfig = {
    apiBaseUrl: '/api',
    wsUrl: `${wsProtocol}//${location.host}/ws`,
    sseUrl: '/api/events',
    retry: { maxAttempts: 3, baseDelayMs: 300 },
    ...overrides,
  };
  return makeEnvironmentProviders([{ provide: APP_CONFIG, useValue: config }]);
}
