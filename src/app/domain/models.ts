export interface Instrument {
  symbol: string;
  name: string;
  sector: string;
}

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  ts: number;
}

export interface InstrumentDetail extends Instrument {
  open: number;
  quote: Quote;
}

export interface PricePoint {
  ts: number;
  price: number;
}

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
/** SUBMITTING is client-only: the optimistic state before the server has acknowledged the order. */
export type OrderStatus = 'SUBMITTING' | 'PENDING' | 'WORKING' | 'FILLED' | 'REJECTED' | 'CANCELLED';

export interface Order {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  limitPrice: number | null;
  status: OrderStatus;
  fillPrice: number | null;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}

export interface OrderDraft {
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  limitPrice: number | null;
}

export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;
}

export interface Portfolio {
  cash: number;
  positions: Position[];
}

export interface NewsItem {
  id: string;
  symbol: string;
  headline: string;
  severity: 'info' | 'warning' | 'critical';
  ts: number;
}

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['FILLED', 'REJECTED', 'CANCELLED']);
