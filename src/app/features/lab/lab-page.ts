import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin, switchMap, timer } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError } from '../../core/http/api-error';
import { InflightRegistry } from '../../core/http/inflight-registry';
import { LoadingService } from '../../core/http/loading.service';
import { EventStream } from '../../core/realtime/event-stream.service';
import { MarketSocket } from '../../core/realtime/market-socket.service';
import { LabApi, ServerStats } from './lab-api';

/**
 * Hands-on proof that each mechanism works, using the server's own hit counters as the
 * source of truth. Open DevTools > Network next to this page.
 */
@Component({
  selector: 'app-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LabApi],
  templateUrl: './lab-page.html',
  styleUrl: './lab-page.scss',
})
export class LabPage {
  private readonly api = inject(LabApi);
  protected readonly auth = inject(AuthService);
  protected readonly socket = inject(MarketSocket);
  protected readonly events = inject(EventStream);
  protected readonly loading = inject(LoadingService);
  protected readonly inflight = inject(InflightRegistry);

  /** Poll server stats every second. toSignal unsubscribes when the page is destroyed. */
  protected readonly stats = toSignal(timer(0, 1000).pipe(switchMap(() => this.api.stats())), {
    initialValue: { hits: {}, sseClients: 0, wsClients: 0 } as ServerStats,
  });
  protected readonly hits = computed(() => Object.entries(this.stats().hits).sort(([a], [b]) => a.localeCompare(b)));

  protected readonly log = signal<string[]>([]);
  protected readonly running = signal<string | null>(null);
  protected readonly tokenSecondsLeft = toSignal(
    timer(0, 1000).pipe(switchMap(async () => Math.max(0, Math.round(((this.auth.expiresAt() ?? 0) - Date.now()) / 1000)))),
    { initialValue: 0 },
  );

  private write(line: string) {
    this.log.update((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 40));
  }
  private async run(name: string, fn: () => Promise<void>) {
    this.running.set(name);
    try {
      await fn();
    } catch (e) {
      this.write(`✗ ${ApiError.from(e).message}`);
    } finally {
      this.running.set(null);
    }
  }
  private async freshStats() {
    return firstValueFrom(this.api.stats());
  }

  protected dedup(enabled: boolean) {
    return this.run('dedup', async () => {
      const before = (await this.freshStats()).hits['GET /api/debug/slow'] ?? 0;
      // 5 independent callers, same URL, same tick
      const results = await firstValueFrom(forkJoin(Array.from({ length: 5 }, () => this.api.slow(enabled))));
      const after = (await this.freshStats()).hits['GET /api/debug/slow'] ?? 0;
      this.write(
        `dedup ${enabled ? 'ON ' : 'OFF'}: 5 subscribers → ${after - before} server hit(s). ` +
          `Distinct responses: ${new Set(results.map((r) => r.servedAt)).size}`,
      );
    });
  }

  protected retry(failures: number) {
    return this.run('retry', async () => {
      const before = (await this.freshStats()).hits['GET /api/debug/flaky'] ?? 0;
      const t0 = performance.now();
      try {
        const res = await firstValueFrom(this.api.flaky(failures));
        this.write(`retry: server failed ${failures}x, client saw ONE success after ${res.attempts} attempts in ${Math.round(performance.now() - t0)} ms`);
      } finally {
        const after = (await this.freshStats()).hits['GET /api/debug/flaky'] ?? 0;
        if (failures > 3) this.write(`retry: gave up after ${after - before} attempts (max 1 + 3 retries); one toast shown`);
      }
    });
  }

  protected refreshStorm() {
    return this.run('refresh', async () => {
      await firstValueFrom(this.api.expireTokens());
      const refreshesBefore = this.auth.refreshCount();
      const serverBefore = (await this.freshStats()).hits['POST /api/auth/refresh'] ?? 0;
      this.write('tokens expired server-side; firing 4 different authenticated GETs in parallel…');
      await firstValueFrom(forkJoin([this.api.me(), this.api.portfolio(), this.api.orders(), this.api.me()]));
      const serverAfter = (await this.freshStats()).hits['POST /api/auth/refresh'] ?? 0;
      this.write(
        `refresh: 4 requests got 401 → ${this.auth.refreshCount() - refreshesBefore} client refresh, ` +
          `${serverAfter - serverBefore} server refresh call(s), all 4 requests replayed OK`,
      );
    });
  }

  protected dropConnections() {
    return this.run('drop', async () => {
      await firstValueFrom(this.api.dropConnections());
      this.write(`server killed all WS + SSE connections (last SSE event id ${this.events.lastEventId() || '-'}); watch the badges reconnect`);
    });
  }

  protected resetStats() {
    void firstValueFrom(this.api.resetStats()).then(() => this.write('server counters reset'));
  }
}
