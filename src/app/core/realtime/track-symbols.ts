import { effect, inject } from '@angular/core';
import { MarketSocket } from './market-socket.service';

/**
 * Declarative "this component needs live prices for these symbols".
 *
 *   trackSymbols(() => this.positions().map(p => p.symbol));
 *
 * It must be called in an injection context (a field initializer or the constructor). The effect
 * re-runs when the list changes. Its cleanup releases the previous list, and also runs when the
 * component is destroyed, so subscriptions can't leak. Like a React useEffect with a cleanup,
 * except the dependencies are tracked automatically, with no dependency array to get wrong.
 */
export function trackSymbols(symbols: () => readonly string[]): void {
  const socket = inject(MarketSocket);
  effect((onCleanup) => {
    const list = symbols();
    if (list.length === 0) return;
    onCleanup(socket.retain(list));
  });
}
