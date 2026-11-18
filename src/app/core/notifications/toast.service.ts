import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  info(message: string, opts?: { title?: string }) {
    this.show('info', message, opts);
  }
  success(message: string, opts?: { title?: string }) {
    this.show('success', message, opts);
  }
  warning(message: string, opts?: { title?: string }) {
    this.show('warning', message, opts);
  }
  error(message: string, opts?: { title?: string }) {
    this.show('error', message, { ...opts, ttl: 7000 });
  }

  /**
   * Identical toasts coalesce into one with a counter ("x3"). If a backend outage fails
   * 6 requests, the user sees one toast, not a wall of them.
   */
  show(kind: ToastKind, message: string, { title, ttl = 4000 }: { title?: string; ttl?: number } = {}) {
    const existing = this._toasts().find((t) => t.kind === kind && t.message === message && t.title === title);
    if (existing) {
      this._toasts.update((list) => list.map((t) => (t === existing ? { ...t, count: t.count + 1 } : t)));
      this.scheduleDismiss(existing.id, ttl);
      return;
    }
    const toast: Toast = { id: ++this.seq, kind, title, message, count: 1 };
    this._toasts.update((list) => [...list.slice(-4), toast]);
    this.scheduleDismiss(toast.id, ttl);
  }

  dismiss(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private scheduleDismiss(id: number, ttl: number) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.dismiss(id), ttl));
  }
}
