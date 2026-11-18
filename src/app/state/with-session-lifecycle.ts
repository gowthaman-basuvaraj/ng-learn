import { effect, inject, untracked } from '@angular/core';
import { AuthService } from '../core/auth/auth.service';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Root-level stores outlive the session. Without this, user A logs out, user B logs in on the
 * same tab and sees A's orders for a frame. Each store calls this from its onInit hook, so
 * the rule is written ONCE.
 *
 * It's an "injection-context function", the Angular equivalent of a custom React hook: it must be
 * called during construction (field initialiser, constructor, or a SignalStore hook), and the effect
 * it creates is cleaned up with whatever injector owns it.
 */
export function onSessionChange(handlers: { start: () => void; end: () => void }): void {
  const auth = inject(AuthService);
  effect(() => {
    const authed = auth.isAuthenticated();
    // untracked: react to auth ONLY, not to whatever signals the handlers happen to read.
    untracked(() => (authed ? handlers.start() : handlers.end()));
  });
}
