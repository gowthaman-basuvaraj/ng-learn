export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Exponential backoff with "full jitter": random between 0 and min(cap, base * 2^attempt). */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 15_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}
