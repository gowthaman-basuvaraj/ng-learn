import { HttpEvent } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Holds in-flight GET observables keyed by request identity.
 * It's a service (not a module-level Map) so every TestBed / app instance gets a fresh one.
 */
@Injectable({ providedIn: 'root' })
export class InflightRegistry {
  private readonly map = new Map<string, Observable<HttpEvent<unknown>>>();

  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, obs: Observable<HttpEvent<unknown>>) {
    this.map.set(key, obs);
  }
  delete(key: string) {
    this.map.delete(key);
  }
  get size() {
    return this.map.size;
  }
}
