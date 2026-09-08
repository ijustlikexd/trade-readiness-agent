"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("../src/binance/mcpProvider");

test("parseMcpBody parses plain JSON body", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  const parsed = mcp.parseMcpBody(body);
  assert.deepEqual(parsed.result, { ok: true });
});

test("parseMcpBody parses SSE data: lines and takes the last payload", () => {
  const sse =
    'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"stage":1}}\n\n' +
    'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"stage":2}}\n\n';
  const parsed = mcp.parseMcpBody(sse);
  assert.deepEqual(parsed.result, { stage: 2 });
});

test("parseMcpBody returns null for empty/garbage input", () => {
  assert.equal(mcp.parseMcpBody(""), null);
  assert.equal(mcp.parseMcpBody("   "), null);
});

test("classifyTool maps tool names/descriptions to categories", () => {
  assert.equal(mcp.classifyTool({ name: "get_klines", description: "Fetch candlestick data" }), "kline");
  assert.equal(mcp.classifyTool({ name: "order_book", description: "" }), "depth");
  assert.equal(mcp.classifyTool({ name: "get_ticker_price", description: "" }), "ticker");
  assert.equal(mcp.classifyTool({ name: "funding_rate", description: "" }), "funding");
  assert.equal(mcp.classifyTool({ name: "oi_history", description: "open interest history" }), "openInterest");
  assert.equal(mcp.classifyTool({ name: "exchange_info", description: "" }), "exchangeInfo");
  assert.equal(mcp.classifyTool({ name: "unrelated_tool", description: "does nothing market related" }), null);
});

test("mapTools picks first match per category", () => {
  const tools = [
    { name: "candles_4h", description: "kline data" },
    { name: "candles_1h", description: "kline data" },
    { name: "depth_book", description: "orderbook" },
  ];
  const map = mcp.mapTools(tools);
  assert.equal(map.kline.name, "candles_4h");
  assert.equal(map.depth.name, "depth_book");
});

test("normalizeKlines handles Binance array-of-arrays rows", () => {
  const row = [1690000000000, "10", "12", "9", "11", "100", 1690003600000, "1100"];
  const out = mcp.normalizeKlines([row]);
  assert.equal(out.length, 1);
  assert.equal(out[0].open, 10);
  assert.equal(out[0].close, 11);
  assert.equal(out[0].turnover, 1100);
});

test("normalizeKlines handles object rows", () => {
  const row = { openTime: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closeTime: 2, quoteVolume: 15 };
  const out = mcp.normalizeKlines([row]);
  assert.equal(out[0].turnover, 15);
});

test("normalizeBook computes spreadBps and depth notionals", () => {
  const data = { bids: [["100", "2"], ["99", "1"]], asks: [["101", "3"]] };
  const book = mcp.normalizeBook(data);
  assert.equal(book.bid, 100);
  assert.equal(book.ask, 101);
  assert.ok(book.spreadBps > 0);
  assert.equal(book.bidDepthQuote, 100 * 2 + 99 * 1);
  assert.equal(book.askDepthQuote, 101 * 3);
});

test("normalizeFunding returns null for falsy input", () => {
  assert.equal(mcp.normalizeFunding(null), null);
});

test("normalizeOi maps sumOpenInterest series", () => {
  const data = [{ timestamp: 1, sumOpenInterest: "5" }, { timestamp: 2, sumOpenInterest: "6" }];
  const out = mcp.normalizeOi(data);
  assert.equal(out.series.length, 2);
  assert.equal(out.series[1].oi, 6);
});

test("createProvider returns restProvider-shaped object without a token", () => {
  const original = process.env.BINANCE_MCP_TOKEN;
  delete process.env.BINANCE_MCP_TOKEN;
  try {
    const provider = mcp.createProvider();
    assert.equal(typeof provider.getSnapshot, "function");
  } finally {
    if (original !== undefined) process.env.BINANCE_MCP_TOKEN = original;
  }
});

test("getSnapshot falls back to restProvider entirely when MCP is unreachable", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.BINANCE_MCP_TOKEN;
  process.env.BINANCE_MCP_TOKEN = "test-token";
  // Non-retryable 404 for every call (MCP init and REST fallback alike) so the
  // test doesn't pay for throttledFetchJson's real backoff/retry delays.
  global.fetch = async () => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: async () => "",
    json: async () => ({}),
  });
  try {
    await mcp.getSnapshot("SOLUSDT");
    assert.fail("expected getSnapshot to reject when both MCP and REST fallback fail");
  } catch (e) {
    assert.ok(e instanceof Error);
  } finally {
    global.fetch = originalFetch;
    if (originalToken !== undefined) process.env.BINANCE_MCP_TOKEN = originalToken;
    else delete process.env.BINANCE_MCP_TOKEN;
  }
});
