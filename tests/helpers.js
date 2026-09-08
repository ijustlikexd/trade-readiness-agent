"use strict";
// Test-only helpers: build synthetic kline arrays (oldest -> newest).

const HOUR_MS = 3600 * 1000;

function buildKlines(highs, lows, closes, opts) {
  opts = opts || {};
  const startTs = opts.startTs || 0;
  const stepMs = opts.stepMs || HOUR_MS;
  const turnover = opts.turnover; // number | number[]
  const volume = opts.volume || 100;
  return highs.map((h, i) => {
    const low = lows[i];
    const close = closes ? closes[i] : (h + low) / 2;
    const open = i === 0 ? close : closes ? closes[i - 1] : (h + low) / 2;
    return {
      openTime: startTs + i * stepMs,
      open,
      high: h,
      low,
      close,
      volume: Array.isArray(volume) ? volume[i] : volume,
      turnover: Array.isArray(turnover) ? turnover[i] : turnover !== undefined ? turnover : volume * close,
      closeTime: startTs + (i + 1) * stepMs - 1,
    };
  });
}

// Linear series from `start` to `end` over `n` bars (inclusive-ish), used for trend tests.
function linSeries(start, end, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(start + ((end - start) * i) / (n - 1));
  return out;
}

// Mirror a snapshot vertically around its current price: price' = 2*mid - price.
// Used to verify SHORT is a true mirror of LONG.
function mirrorSnapshot(snapshot) {
  const mid = snapshot.price;
  const flip = (v) => 2 * mid - v;
  const mirrorKl = (kl) =>
    kl.map((k) => ({
      ...k,
      open: flip(k.open),
      high: flip(k.low),
      low: flip(k.high),
      close: flip(k.close),
    }));
  return {
    ...snapshot,
    price: mid,
    klines: { "4h": mirrorKl(snapshot.klines["4h"]), "1h": mirrorKl(snapshot.klines["1h"]) },
    book: snapshot.book
      ? {
          bid: flip(snapshot.book.ask),
          ask: flip(snapshot.book.bid),
          spreadBps: snapshot.book.spreadBps,
          bidDepthQuote: snapshot.book.askDepthQuote,
          askDepthQuote: snapshot.book.bidDepthQuote,
        }
      : null,
    funding: snapshot.funding
      ? { rate: -snapshot.funding.rate, nextFundingTime: snapshot.funding.nextFundingTime, markPrice: flip(snapshot.funding.markPrice) }
      : null,
  };
}

// A synthetic, strictly-monotonic snapshot: no interior swing fractals, so the greedy
// SNR clustering pass (which is order-dependent for 3+ same-side candidates, per SPEC §4)
// only ever sees <=2 candidates per side (prevDay + range) and is guaranteed symmetric.
// Used specifically to verify SHORT is a true mirror of LONG end-to-end.
function buildMonotonicSnapshot(symbol, start, end, opts) {
  opts = opts || {};
  const n4h = opts.n4h || 60;
  const n1h = opts.n1h || 200;
  const series = (n) => {
    const closes = linSeries(start, end, n);
    return { highs: closes.map((c) => c + 0.05), lows: closes.map((c) => c - 0.05), closes };
  };
  const d4 = series(n4h);
  const d1 = series(n1h);
  const kl4h = buildKlines(d4.highs, d4.lows, d4.closes, { stepMs: 4 * HOUR_MS });
  const kl1h = buildKlines(d1.highs, d1.lows, d1.closes, { stepMs: HOUR_MS });
  const price = d4.closes[d4.closes.length - 1];
  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    source: "rest",
    tickSize: "0.01",
    price,
    klines: { "4h": kl4h, "1h": kl1h },
    book: { bid: price - 0.01, ask: price + 0.01, spreadBps: 1, bidDepthQuote: 1000, askDepthQuote: 1000 },
    funding: { rate: 0.0001, nextFundingTime: 0, markPrice: price },
    oi: { series: Array.from({ length: 24 }, (_, i) => ({ ts: i, oi: 1000 + i })) },
  };
}

module.exports = { buildKlines, linSeries, mirrorSnapshot, buildMonotonicSnapshot, HOUR_MS };
