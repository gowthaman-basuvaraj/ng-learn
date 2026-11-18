import { Injectable, computed, signal } from '@angular/core';

/** Global "something is loading" counter that drives the top progress bar. */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly inflight = signal(0);
  readonly count = this.inflight.asReadonly();
  readonly busy = computed(() => this.inflight() > 0);

  start() {
    this.inflight.update((n) => n + 1);
  }
  stop() {
    this.inflight.update((n) => Math.max(0, n - 1));
  }
}
