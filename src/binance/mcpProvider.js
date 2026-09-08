"use strict";
// Binance Agent OS MCP client (Streamable HTTP, JSON-RPC 2.0). docs/SPEC.md §1.
// Minimal hand-rolled client: initialize -> notifications/initialized -> tools/list
// -> tools/call, mapping tool results onto Snapshot fields by name/description
// heuristics. Any field we can't map falls back to restProvider for that field.

let sessionId = null;
let rpcId = 1;

function mcpUrl() {
  return process.env.BINANCE_MCP_URL || "https://agent.binance.com/mcp/agentic";
}

function mcpHeaders(extra) {
  const h = Object.assign(
    {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    extra
  );
  if (process.env.BINANCE_MCP_TOKEN) h.Authorization = `Bearer ${process.env.BINANCE_MCP_TOKEN}`;
  if (sessionId) h["Mcp-Session-Id"] = sessionId;
  return h;
}

// Parse a Streamable-HTTP response body: either a plain JSON object, or an SSE
// stream of `data: {...}` lines (return the last parsed JSON payload found).
function parseMcpBody(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      /* fall through to SSE parsing */
    }
  }
  let last = null;
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const payload = l.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      last = JSON.parse(payload);
    } catch (e) {
      /* ignore malformed SSE data line */
    }
  }
  return last;
}

async function rpcCall(method, params, opts = {}) {
  const id = rpcId++;
  const body = { jsonrpc: "2.0", id, method };
  if (params !== undefined) body.params = params;
  const res = await fetch(mcpUrl(), {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(body),
  });
  const newSession = res.headers && res.headers.get && res.headers.get("Mcp-Session-Id");
  if (newSession) sessionId = newSession;
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const json = parseMcpBody(text);
  if (json && json.error) {
    const err = new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    err.rpcError = json.error;
    throw err;
  }
  return json ? json.result : null;
}

async function rpcNotify(method, params) {
  // Notifications get no id and expect no result body.
  const body = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  await fetch(mcpUrl(), {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function initSession() {
  sessionId = null;
  await rpcCall("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "trade-readiness-agent", version: "0.1.0" },
  });
  await rpcNotify("notifications/initialized");
}

async function listTools() {
  const result = await rpcCall("tools/list");
  return (result && result.tools) || [];
}

async function callTool(name, args) {
  const result = await rpcCall("tools/call", { name, arguments: args || {} });
  return result;
}

// --- Tool-name/description heuristics -------------------------------------

const CATEGORY_PATTERNS = {
  kline: /kline|candle|ohlc/i,
  depth: /depth|order.?book/i,
  ticker: /ticker|price|last.?trade/i,
  funding: /funding/i,
  openInterest: /open.?interest|\boi\b/i,
  exchangeInfo: /exchange.?info|symbol.?info|tick.?size/i,
};

function classifyTool(tool) {
  const hay = `${tool.name || ""} ${tool.description || ""}`;
  for (const [cat, re] of Object.entries(CATEGORY_PATTERNS)) {
    if (re.test(hay)) return cat;
  }
  return null;
}

// Map the tool list into { category -> tool } (first match wins per category).
function mapTools(tools) {
  const map = {};
  for (const t of tools) {
    const cat = classifyTool(t);
    if (cat && !map[cat]) map[cat] = t;
  }
  return map;
}

function firstTextContent(result) {
  const content = (result && result.content) || [];
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") return c.text;
  }
  return null;
}

function tryParseJson(text) {
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function toolJson(tool, args) {
  const result = await callTool(tool.name, args);
  const text = firstTextContent(result);
  const parsed = tryParseJson(text);
  return parsed !== null ? parsed : result;
}

// Build a Snapshot using MCP tools where mappable, falling back to restProvider
// for any field we couldn't map or that errored. See docs/SPEC.md §1.
async function getSnapshot(symbol) {
  const restProvider = require("./restProvider");
  const rest = restProvider.getSnapshot;

  let tools = [];
  try {
    await initSession();
    tools = await listTools();
  } catch (e) {
    // MCP unreachable/misconfigured entirely -> full REST fallback.
    return rest(symbol);
  }

  const mapped = mapTools(tools);
  const missing = [];
  const snapshot = { symbol, source: "mcp" };

  // exchangeInfo -> tickSize
  if (mapped.exchangeInfo) {
    try {
      const data = await toolJson(mapped.exchangeInfo, { symbol });
      const filters = (data && data.symbols && data.symbols[0] && data.symbols[0].filters) || data.filters || [];
      const pf = Array.isArray(filters) ? filters.find((f) => f.filterType === "PRICE_FILTER") : null;
      snapshot.tickSize = pf ? Number(pf.tickSize) : null;
    } catch (e) {
      missing.push("tickSize");
    }
  } else {
    missing.push("tickSize");
  }

  // ticker -> price
  if (mapped.ticker) {
    try {
      const data = await toolJson(mapped.ticker, { symbol });
      snapshot.price = Number(data.price !== undefined ? data.price : data.lastPrice);
    } catch (e) {
      missing.push("price");
    }
  } else {
    missing.push("price");
  }

  // kline -> klines.4h / klines.1h
  if (mapped.kline) {
    try {
      const k4 = await toolJson(mapped.kline, { symbol, interval: "4h", limit: 300 });
      const k1 = await toolJson(mapped.kline, { symbol, interval: "1h", limit: 500 });
      snapshot.klines = { "4h": normalizeKlines(k4), "1h": normalizeKlines(k1) };
    } catch (e) {
      missing.push("klines");
    }
  } else {
    missing.push("klines");
  }

  // depth -> book
  if (mapped.depth) {
    try {
      const data = await toolJson(mapped.depth, { symbol, limit: 20 });
      snapshot.book = normalizeBook(data);
    } catch (e) {
      missing.push("book");
    }
  } else {
    missing.push("book");
  }

  // funding (nullable, never causes fallback of other fields)
  if (mapped.funding) {
    try {
      const data = await toolJson(mapped.funding, { symbol });
      snapshot.funding = normalizeFunding(data);
    } catch (e) {
      snapshot.funding = null;
    }
  } else {
    snapshot.funding = undefined; // signal: get from REST below
  }

  // open interest (nullable)
  if (mapped.openInterest) {
    try {
      const data = await toolJson(mapped.openInterest, { symbol, period: "1h", limit: 24 });
      snapshot.oi = normalizeOi(data);
    } catch (e) {
      snapshot.oi = null;
    }
  } else {
    snapshot.oi = undefined;
  }

  if (missing.length === 0 && snapshot.funding !== undefined && snapshot.oi !== undefined) {
    snapshot.fetchedAt = new Date().toISOString();
    return snapshot;
  }

  // Partial fallback: fill only the missing/undefined pieces from REST.
  const restSnap = await rest(symbol);
  const merged = Object.assign({}, restSnap, snapshot);
  for (const field of missing) merged[field] = restSnap[field];
  if (snapshot.funding === undefined) merged.funding = restSnap.funding;
  if (snapshot.oi === undefined) merged.oi = restSnap.oi;
  merged.symbol = symbol;
  merged.fetchedAt = new Date().toISOString();
  merged.source = missing.length || snapshot.funding === undefined || snapshot.oi === undefined ? "mcp+rest" : "mcp";
  return merged;
}

function normalizeKlines(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((row) => {
    if (Array.isArray(row)) {
      return {
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
        turnover: Number(row[7]),
      };
    }
    return {
      openTime: Number(row.openTime),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      closeTime: Number(row.closeTime),
      turnover: Number(row.turnover !== undefined ? row.turnover : row.quoteVolume),
    };
  });
}

function normalizeBook(data) {
  const bids = data.bids || [];
  const asks = data.asks || [];
  const bid = bids[0] ? Number(bids[0][0]) : null;
  const ask = asks[0] ? Number(asks[0][0]) : null;
  const spreadBps = bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 10000 : null;
  const sumNotional = (levels) => levels.reduce((a, l) => a + Number(l[0]) * Number(l[1]), 0);
  return {
    bid,
    ask,
    spreadBps,
    bidDepthQuote: sumNotional(bids),
    askDepthQuote: sumNotional(asks),
  };
}

function normalizeFunding(data) {
  if (!data) return null;
  return {
    rate: Number(data.lastFundingRate !== undefined ? data.lastFundingRate : data.rate),
    nextFundingTime: data.nextFundingTime,
    markPrice: Number(data.markPrice),
  };
}

function normalizeOi(data) {
  const arr = Array.isArray(data) ? data : data && data.series;
  if (!Array.isArray(arr)) return null;
  return {
    series: arr.map((r) => ({ ts: r.timestamp || r.ts, oi: Number(r.sumOpenInterest !== undefined ? r.sumOpenInterest : r.oi) })),
  };
}

async function probe() {
  await initSession();
  const tools = await listTools();
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

function createProvider() {
  if (process.env.BINANCE_MCP_TOKEN) {
    return { getSnapshot };
  }
  return require("./restProvider");
}

module.exports = {
  getSnapshot,
  probe,
  createProvider,
  parseMcpBody,
  classifyTool,
  mapTools,
  normalizeKlines,
  normalizeBook,
  normalizeFunding,
  normalizeOi,
};
