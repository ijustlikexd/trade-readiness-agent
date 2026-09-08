"use strict";
/**
 * Default IDataProvider: Binance public REST endpoints, no API key.
 * getSnapshot(symbol) -> Snapshot per docs/SPEC.md §1.
 * funding/oi failures -> null (never throw). klines/price/book failure -> throw.
 */
const { throttledFetchJson } = require("../lib/http-host-throttle");
const { fetchBinanceOIHist } = require("../lib/crypto-market-meta");

const CONFIG = {
  SPOT_BASE: "https://api.binance.com",
  FAPI_BASE: "https://fapi.binance.com",
  KLINE_LIMIT_4H: 300,
  KLINE_LIMIT_1H: 500,
  DEPTH_LIMIT: 20,
  OI_PERIOD: "1h",
  OI_LIMIT: 24,
};

// Binance kline array -> Kline object (oldest->newest as returned by API).
function mapKline(row) {
  return {
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6],
    turnover: Number(row[7]), // quote asset volume
  };
}

async function fetchKlines(symbol, interval, limit) {
  const url = `${CONFIG.SPOT_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await throttledFetchJson(url);
  if (!r.ok || !Array.isArray(r.data)) {
    throw new Error(`klines ${symbol} ${interval} failed: ${r.error || "bad response"}`);
  }
  return r.data.map(mapKline);
}

async function fetchExchangeInfo(symbol) {
  const url = `${CONFIG.SPOT_BASE}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`;
  const r = await throttledFetchJson(url);
  if (!r.ok || !r.data || !Array.isArray(r.data.symbols) || !r.data.symbols[0]) {
    throw new Error(`exchangeInfo ${symbol} failed: ${r.error || "bad response"}`);
  }
  const filters = r.data.symbols[0].filters || [];
  const priceFilter = filters.find((f) => f.filterType === "PRICE_FILTER");
  return priceFilter ? priceFilter.tickSize : null;
}

async function fetchPrice(symbol) {
  const url = `${CONFIG.SPOT_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const r = await throttledFetchJson(url);
  if (!r.ok || !r.data || r.data.price === undefined) {
    throw new Error(`ticker/price ${symbol} failed: ${r.error || "bad response"}`);
  }
  return Number(r.data.price);
}

async function fetchBook(symbol) {
  const url = `${CONFIG.SPOT_BASE}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${CONFIG.DEPTH_LIMIT}`;
  const r = await throttledFetchJson(url);
  if (!r.ok || !r.data || !Array.isArray(r.data.bids) || !Array.isArray(r.data.asks)) {
    throw new Error(`depth ${symbol} failed: ${r.error || "bad response"}`);
  }
  const bids = r.data.bids.map((b) => [Number(b[0]), Number(b[1])]);
  const asks = r.data.asks.map((a) => [Number(a[0]), Number(a[1])]);
  const bid = bids.length ? bids[0][0] : null;
  const ask = asks.length ? asks[0][0] : null;
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const spreadBps = bid !== null && ask !== null && mid ? ((ask - bid) / mid) * 10000 : null;
  const sumNotional = (levels) => levels.reduce((a, [price, qty]) => a + price * qty, 0);
  return {
    bid,
    ask,
    spreadBps,
    bidDepthQuote: sumNotional(bids),
    askDepthQuote: sumNotional(asks),
  };
}

async function fetchFunding(symbol) {
  try {
    const url = `${CONFIG.FAPI_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    const r = await throttledFetchJson(url);
    if (!r.ok || !r.data || r.data.lastFundingRate === undefined) return null;
    return {
      rate: Number(r.data.lastFundingRate),
      nextFundingTime: r.data.nextFundingTime,
      markPrice: Number(r.data.markPrice),
    };
  } catch (e) {
    return null;
  }
}

async function fetchOi(symbol) {
  try {
    const r = await fetchBinanceOIHist(symbol, CONFIG.OI_PERIOD, CONFIG.OI_LIMIT);
    if (!r.ok || !Array.isArray(r.rows) || r.rows.length === 0) return null;
    return { series: r.rows.map((x) => ({ ts: x.ts, oi: x.oi })) };
  } catch (e) {
    return null;
  }
}

async function getSnapshot(symbol) {
  const [tickSize, price, book, klines4h, klines1h] = await Promise.all([
    fetchExchangeInfo(symbol),
    fetchPrice(symbol),
    fetchBook(symbol),
    fetchKlines(symbol, "4h", CONFIG.KLINE_LIMIT_4H),
    fetchKlines(symbol, "1h", CONFIG.KLINE_LIMIT_1H),
  ]);
  const [funding, oi] = await Promise.all([fetchFunding(symbol), fetchOi(symbol)]);

  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    source: "rest",
    tickSize,
    price,
    klines: { "4h": klines4h, "1h": klines1h },
    book,
    funding,
    oi,
  };
}

module.exports = { getSnapshot, CONFIG };
