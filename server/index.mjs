// Mock backend for the Angular app.
//
//   REST  : /api/**            (JSON, bearer auth, artificial latency)
//   SSE   : /api/events        (order + news events, Last-Event-ID replay)
//   WS    : /ws                (subscribe/unsubscribe price ticks per symbol)
//   Debug : /api/debug/**      (lets you *see* dedup, retry, token refresh, reconnects)
//
// Plain node:http on purpose - nothing here is framework magic.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 3000);
const ACCESS_TTL_MS = 60_000; // short on purpose so you see refresh happen
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- market data
const instruments = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 228.4 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', price: 431.1 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Semiconductors', price: 141.9 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', price: 197.3 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication', price: 172.6 },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication', price: 589.2 },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive', price: 251.7 },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', price: 224.8 },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', price: 118.5 },
  { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Staples', price: 64.2 },
].map((i) => ({ ...i, open: i.price }));
const bySymbol = new Map(instruments.map((i) => [i.symbol, i]));

function stepPrices() {
  for (const i of instruments) {
    const drift = (Math.random() - 0.5) * i.price * 0.002;
    i.price = Math.max(1, +(i.price + drift).toFixed(2));
  }
}

function quote(i) {
  return {
    symbol: i.symbol,
    price: i.price,
    change: +(i.price - i.open).toFixed(2),
    changePct: +(((i.price - i.open) / i.open) * 100).toFixed(3),
    ts: Date.now(),
  };
}

function history(i, points) {
  // random walk backwards from the current price
  const out = [];
  let p = i.price;
  const now = Date.now();
  for (let k = 0; k < points; k++) {
    out.unshift({ ts: now - k * 1000, price: +p.toFixed(2) });
    p = Math.max(1, p - (Math.random() - 0.5) * p * 0.002);
  }
  return out;
}

// ---------------------------------------------------------------- auth
const users = { demo: { id: 'u1', username: 'demo', displayName: 'Demo Trader', password: 'demo' } };
const accessTokens = new Map(); // token -> { userId, exp }
const refreshTokens = new Map(); // token -> userId

function issueTokens(user) {
  const accessToken = 'at_' + randomUUID();
  const refreshToken = 'rt_' + randomUUID();
  accessTokens.set(accessToken, { userId: user.id, exp: Date.now() + ACCESS_TTL_MS });
  refreshTokens.set(refreshToken, user.id);
  const { password, ...publicUser } = user;
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000, user: publicUser };
}

function userFromToken(token) {
  const rec = token && accessTokens.get(token);
  if (!rec || rec.exp < Date.now()) return null;
  return Object.values(users).find((u) => u.id === rec.userId) ?? null;
}

// ---------------------------------------------------------------- trading state
const portfolio = {
  cash: 100_000,
  positions: new Map([
    ['AAPL', { symbol: 'AAPL', qty: 50, avgPrice: 210.5 }],
    ['NVDA', { symbol: 'NVDA', qty: 120, avgPrice: 118.2 }],
    ['KO', { symbol: 'KO', qty: 200, avgPrice: 61.0 }],
  ]),
};
const orders = new Map(); // id -> order
const idempotency = new Map(); // Idempotency-Key -> order id

function applyFill(order, price) {
  const pos = portfolio.positions.get(order.symbol) ?? { symbol: order.symbol, qty: 0, avgPrice: 0 };
  const signed = order.side === 'BUY' ? order.qty : -order.qty;
  const newQty = pos.qty + signed;
  if (order.side === 'BUY') {
    pos.avgPrice = +((pos.avgPrice * pos.qty + price * order.qty) / newQty).toFixed(2);
  }
  pos.qty = newQty;
  portfolio.cash = +(portfolio.cash - signed * price).toFixed(2);
  if (pos.qty === 0) portfolio.positions.delete(order.symbol);
  else portfolio.positions.set(order.symbol, pos);
  Object.assign(order, { status: 'FILLED', fillPrice: price, updatedAt: Date.now() });
  publish('order', order);
}

function processWorkingOrders() {
  for (const o of orders.values()) {
    if (o.status !== 'WORKING') continue;
    const px = bySymbol.get(o.symbol).price;
    const crosses = o.side === 'BUY' ? px <= o.limitPrice : px >= o.limitPrice;
    if (crosses) applyFill(o, px);
  }
}

// ---------------------------------------------------------------- SSE hub
const sseClients = new Set();
const eventLog = []; // last N events for Last-Event-ID replay
let eventSeq = 0;

function publish(type, data) {
  const evt = { id: ++eventSeq, type, data };
  eventLog.push(evt);
  if (eventLog.length > 200) eventLog.shift();
  for (const res of sseClients) writeEvent(res, evt);
}
function writeEvent(res, evt) {
  res.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
}

const headlines = [
  ['NVDA', 'NVIDIA unveils next-gen datacenter GPU', 'info'],
  ['AAPL', 'Apple supplier hints at stronger holiday quarter', 'info'],
  ['TSLA', 'Tesla recalls 12k vehicles over software issue', 'warning'],
  ['JPM', 'JPMorgan raises dividend 8%', 'info'],
  ['XOM', 'Oil slides as inventories build', 'warning'],
  ['META', 'Regulators open inquiry into Meta ad targeting', 'critical'],
  ['MSFT', 'Microsoft cloud revenue beats estimates', 'info'],
];
setInterval(() => {
  const [symbol, headline, severity] = headlines[Math.floor(Math.random() * headlines.length)];
  publish('news', { id: randomUUID(), symbol, headline, severity, ts: Date.now() });
}, 12_000);
setInterval(() => {
  for (const res of sseClients) res.write(': heartbeat\n\n'); // keeps proxies from timing out
}, 15_000);

// ---------------------------------------------------------------- debug counters
const hits = {};
const flakyCounters = new Map();
const count = (key) => (hits[key] = (hits[key] ?? 0) + 1);

// ---------------------------------------------------------------- HTTP plumbing
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}
const problem = (res, status, code, message, extra) => send(res, status, { code, message, ...extra });

const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, auth, pattern });
};

// -- auth
route('POST', '/api/auth/login', async (req, res) => {
  await sleep(400);
  const body = await readJson(req);
  const user = users[body?.username];
  if (!user || user.password !== body?.password) return problem(res, 401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  send(res, 200, issueTokens(user));
}, { auth: false });

route('POST', '/api/auth/refresh', async (req, res) => {
  await sleep(500); // slow on purpose: lets parallel 401s pile up behind ONE refresh
  const body = await readJson(req);
  const userId = refreshTokens.get(body?.refreshToken);
  if (!userId) return problem(res, 401, 'REFRESH_INVALID', 'Session expired, please sign in again');
  refreshTokens.delete(body.refreshToken); // rotation: refresh tokens are single use
  send(res, 200, issueTokens(Object.values(users).find((u) => u.id === userId)));
}, { auth: false });

route('GET', '/api/me', async (_req, res, ctx) => send(res, 200, ctx.user));

// -- market data
route('GET', '/api/instruments', async (_req, res) => {
  await sleep(600);
  send(res, 200, instruments.map(({ symbol, name, sector }) => ({ symbol, name, sector })));
});
route('GET', '/api/quotes', async (_req, res) => {
  await sleep(200);
  send(res, 200, instruments.map(quote));
});
route('GET', '/api/instruments/:symbol', async (_req, res, { params }) => {
  await sleep(300);
  const i = bySymbol.get(params.symbol.toUpperCase());
  if (!i) return problem(res, 404, 'NOT_FOUND', `Unknown symbol ${params.symbol}`);
  send(res, 200, { symbol: i.symbol, name: i.name, sector: i.sector, open: i.open, quote: quote(i) });
});
route('GET', '/api/instruments/:symbol/history', async (_req, res, { params, query }) => {
  await sleep(500);
  const i = bySymbol.get(params.symbol.toUpperCase());
  if (!i) return problem(res, 404, 'NOT_FOUND', `Unknown symbol ${params.symbol}`);
  send(res, 200, history(i, Math.min(300, Number(query.get('points') ?? 90))));
});

// -- portfolio & orders
route('GET', '/api/portfolio', async (_req, res) => {
  await sleep(300);
  send(res, 200, { cash: portfolio.cash, positions: [...portfolio.positions.values()] });
});
route('GET', '/api/orders', async (_req, res) => {
  await sleep(250);
  send(res, 200, [...orders.values()].sort((a, b) => b.createdAt - a.createdAt));
});
route('POST', '/api/orders', async (req, res) => {
  await sleep(350);
  const key = req.headers['idempotency-key'];
  if (!key) return problem(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (idempotency.has(key)) {
    // Same key => same result. Retries (network blips, double clicks) never create duplicates.
    return send(res, 200, orders.get(idempotency.get(key)), { 'Idempotent-Replay': 'true' });
  }
  const b = await readJson(req);
  const errors = {};
  if (!bySymbol.has(b?.symbol)) errors.symbol = 'Unknown symbol';
  if (!['BUY', 'SELL'].includes(b?.side)) errors.side = 'Must be BUY or SELL';
  if (!Number.isInteger(b?.qty) || b.qty <= 0) errors.qty = 'Must be a positive integer';
  if (b?.type === 'LIMIT' && !(b.limitPrice > 0)) errors.limitPrice = 'Required for limit orders';
  if (b?.side === 'SELL' && (portfolio.positions.get(b.symbol)?.qty ?? 0) < b.qty) errors.qty = 'Insufficient position to sell';
  if (Object.keys(errors).length) return problem(res, 422, 'VALIDATION_FAILED', 'Order rejected', { fieldErrors: errors });

  const order = {
    id: 'ord_' + randomUUID().slice(0, 8),
    symbol: b.symbol, side: b.side, qty: b.qty, type: b.type ?? 'MARKET',
    limitPrice: b.type === 'LIMIT' ? b.limitPrice : null,
    status: b.type === 'LIMIT' ? 'WORKING' : 'PENDING',
    fillPrice: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  orders.set(order.id, order);
  idempotency.set(key, order.id);
  send(res, 201, order);
  publish('order', order);
  if (order.type === 'MARKET') {
    setTimeout(() => {
      if (Math.random() < 0.1) {
        Object.assign(order, { status: 'REJECTED', updatedAt: Date.now(), reason: 'No liquidity' });
        publish('order', order);
      } else applyFill(order, bySymbol.get(order.symbol).price);
    }, 1200 + Math.random() * 800);
  }
});
route('DELETE', '/api/orders/:id', async (_req, res, { params }) => {
  await sleep(250);
  const o = orders.get(params.id);
  if (!o) return problem(res, 404, 'NOT_FOUND', 'No such order');
  if (o.status !== 'WORKING') return problem(res, 409, 'NOT_CANCELLABLE', `Order is ${o.status}`);
  Object.assign(o, { status: 'CANCELLED', updatedAt: Date.now() });
  publish('order', o);
  send(res, 200, o);
});

// -- debug / lab
route('GET', '/api/debug/stats', async (_req, res) => send(res, 200, { hits, sseClients: sseClients.size, wsClients: wss.clients.size }), { auth: false });
route('POST', '/api/debug/reset-stats', async (_req, res) => {
  for (const k of Object.keys(hits)) delete hits[k];
  flakyCounters.clear();
  send(res, 204);
}, { auth: false });
route('GET', '/api/debug/slow', async (_req, res, { query }) => {
  await sleep(Number(query.get('ms') ?? 1500));
  send(res, 200, { servedAt: Date.now(), hit: hits['GET /api/debug/slow'] });
});
route('GET', '/api/debug/flaky', async (_req, res, { query }) => {
  const key = query.get('key') ?? 'default';
  const failures = Number(query.get('failures') ?? 2);
  const n = (flakyCounters.get(key) ?? 0) + 1;
  flakyCounters.set(key, n);
  await sleep(150);
  if (n <= failures) return problem(res, 503, 'UNAVAILABLE', `Attempt ${n} failed (will succeed after ${failures})`);
  send(res, 200, { ok: true, attempts: n });
});
route('POST', '/api/debug/expire-tokens', async (_req, res) => {
  accessTokens.clear(); // every access token is now invalid -> next requests get 401
  send(res, 204);
}, { auth: false });
route('POST', '/api/debug/drop-connections', async (_req, res) => {
  for (const ws of wss.clients) ws.terminate();
  for (const r of sseClients) r.destroy();
  send(res, 204);
}, { auth: false });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // ----- SSE: EventSource cannot send headers, so the token rides in the query string.
  if (req.method === 'GET' && path === '/api/events') {
    count('GET /api/events');
    if (!userFromToken(url.searchParams.get('access_token'))) return problem(res, 401, 'TOKEN_EXPIRED', 'Invalid token');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    // Browser auto-reconnect sends Last-Event-ID -> replay what the client missed.
    const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('lastEventId') ?? 0);
    if (lastId) for (const e of eventLog) if (e.id > lastId) writeEvent(res, e);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    count(`${r.method} ${r.pattern}`);
    const params = Object.fromEntries(r.keys.map((k, idx) => [k, decodeURIComponent(m[idx + 1])]));
    let user = null;
    if (r.auth) {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      user = userFromToken(token);
      if (!user) return problem(res, 401, 'TOKEN_EXPIRED', 'Access token missing or expired');
    }
    try {
      return await r.handler(req, res, { params, query: url.searchParams, user });
    } catch (e) {
      console.error(e);
      return problem(res, 500, 'INTERNAL', 'Unexpected server error');
    }
  }
  problem(res, 404, 'NOT_FOUND', `No route for ${req.method} ${path}`);
});

// ---------------------------------------------------------------- WebSocket: price ticks
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    count('WS /ws');
    if (!userFromToken(url.searchParams.get('access_token'))) {
      // App-level close code (4000-4999 are free for apps). Client refreshes + reconnects.
      return ws.close(4401, 'Unauthorized');
    }
    ws.symbols = new Set();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'subscribe') {
        for (const s of msg.symbols ?? []) if (bySymbol.has(s)) ws.symbols.add(s);
        ws.send(JSON.stringify({ type: 'subscribed', symbols: [...ws.symbols] }));
        // send a snapshot immediately so the UI doesn't wait for the next tick
        for (const s of msg.symbols ?? []) if (bySymbol.has(s)) ws.send(JSON.stringify({ type: 'tick', ...quote(bySymbol.get(s)) }));
      } else if (msg.type === 'unsubscribe') {
        for (const s of msg.symbols ?? []) ws.symbols.delete(s);
        ws.send(JSON.stringify({ type: 'subscribed', symbols: [...ws.symbols] }));
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    });
  });
});

setInterval(() => {
  stepPrices();
  processWorkingOrders();
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN || !ws.symbols) continue;
    for (const s of ws.symbols) ws.send(JSON.stringify({ type: 'tick', ...quote(bySymbol.get(s)) }));
  }
}, 500);

server.listen(PORT, () => console.log(`[mock-api] http://localhost:${PORT}  (login: demo / demo)`));
