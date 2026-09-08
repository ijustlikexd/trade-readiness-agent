"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { findSwings, computeTrend, computeRange } = require("../src/analysis/structure");
const { ema, computeATR } = require("../src/lib/kline-indicators");
const { buildKlines, linSeries } = require("./helpers");

test("findSwings: hand-built 15-bar array finds exact fractal indices", () => {
  const highs = [100, 101, 102, 103, 104, 105, 106, 110, 106, 105, 104, 103, 102, 101, 100];
  const lows = [90, 89, 88, 87, 80, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96];
  const kl = buildKlines(highs, lows);
  const swings = findSwings(kl, 3);
  const H = swings.filter((s) => s.kind === "H");
  const L = swings.filter((s) => s.kind === "L");
  assert.strictEqual(H.length, 1);
  assert.strictEqual(H[0].idx, 7);
  assert.strictEqual(H[0].price, 110);
  assert.strictEqual(L.length, 1);
  assert.strictEqual(L[0].idx, 4);
  assert.strictEqual(L[0].price, 80);
});

test("findSwings: edge bars (within n of start/end) never confirmed", () => {
  const highs = [50, 49, 48, 47, 46, 45, 44, 43, 42, 41];
  const lows = highs.map((h) => h - 10);
  const kl = buildKlines(highs, lows);
  const swings = findSwings(kl, 3);
  swings.forEach((s) => {
    assert.ok(s.idx >= 3 && s.idx <= kl.length - 1 - 3);
  });
});

function tfIndicatorsFor(kl) {
  const closes = kl.map((k) => k.close);
  return { ema20: ema(closes, 20), ema50: ema(closes, 50) };
}

test("computeTrend: synthetic monotonic uptrend classifies bullish", () => {
  const closes = linSeries(100, 200, 120);
  const highs = closes.map((c) => c + 1);
  const lows = closes.map((c) => c - 1);
  const kl = buildKlines(highs, lows, closes);
  const trend = computeTrend(kl, tfIndicatorsFor(kl), findSwings(kl));
  assert.strictEqual(trend.label, "bullish");
  assert.ok(trend.score >= 2);
});

test("computeTrend: synthetic monotonic downtrend classifies bearish", () => {
  const closes = linSeries(200, 100, 120);
  const highs = closes.map((c) => c + 1);
  const lows = closes.map((c) => c - 1);
  const kl = buildKlines(highs, lows, closes);
  const trend = computeTrend(kl, tfIndicatorsFor(kl), findSwings(kl));
  assert.strictEqual(trend.label, "bearish");
  assert.ok(trend.score <= -2);
});

test("computeRange: breakout flag set when close exceeds prior 30-bar high", () => {
  const closes = new Array(31).fill(100);
  closes[30] = 150; // last bar breaks out
  const highs = closes.map((c) => c);
  const lows = closes.map((c) => c - 5);
  const kl = buildKlines(highs, lows, closes);
  const { breakout, breakdown } = computeRange(kl);
  assert.strictEqual(breakout, true);
  assert.strictEqual(breakdown, false);
});
