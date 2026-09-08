"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderText, renderScanLine } = require("../src/output/report");

function buildResult(overrides) {
  const base = {
    symbol: "SOLUSDT",
    generatedAt: "2026-09-08T00:00:00.000Z",
    source: "rest",
    price: 120.5,
    regime: "Bullish Pullback",
    trend: { "4h": { trend: "bullish" }, "1h": { trend: "neutral" } },
    structure: { swings4h: [], swings1h: [], range: { rangeHigh: 130, rangeLow: 110 }, breakout: false, breakdown: false },
    snr: {
      support: { level: 118.65, zoneLow: 118.2, zoneHigh: 119.1, weight: 3, touches: 2, score: 0.8 },
      resistance: { level: 123.4, zoneLow: 123.0, zoneHigh: 123.8, weight: 2, touches: 1, score: 0.6 },
      supports: [],
      resistances: [],
    },
    plan: {
      direction: "LONG",
      entryZone: [118.2, 119.1],
      entry: 119.1,
      invalidation: 117.6,
      target1: 123.4,
      target2: null,
      rr: 2.31,
      distanceAtr: 0.3,
    },
    confluence: {
      score: 82,
      availWeight: 0.95,
      lowCoverage: false,
      factors: {
        htf: { val: 72, weight: 25, note: "4h aligned", status: "ok" },
        snr: { val: 80, weight: 20, note: "strong support", status: "ok" },
        vegas: { val: 55, weight: 15, note: "aligned not near", status: "warn" },
        volume: { val: 20, weight: 15, note: "weak", status: "bad" },
        oi: { val: 100, weight: 10, note: "OI rising with price", status: "ok" },
        funding: { val: 60, weight: 5, note: "elevated", status: "warn" },
        liquidity: { val: 100, weight: 5, note: "tight spread", status: "ok" },
        rr: { val: 80, weight: 5, note: "rr 2.31", status: "ok" },
      },
    },
    gate: { decision: "WATCH", hardReasons: [], watchReasons: ["Waiting for confirmation near support."] },
    decision: "WATCH",
    raw: { atr4h: 2.1, atr1h: 0.8, volZ: -1.2, spreadBps: 1.5, funding: 0.0004, oiChangePct: 3.2, priceChangePct24h: 1.1, decimals: 2 },
  };
  return Object.assign({}, base, overrides);
}

test("renderText contains decision, entry, rr", () => {
  const result = buildResult();
  const text = renderText(result);
  assert.match(text, /WATCH/);
  assert.match(text, /119\.10/);
  assert.match(text, /2\.31/);
  assert.match(text, /SOLUSDT TRADE PASSPORT/);
});

test("renderText includes explanation when provided", () => {
  const result = buildResult();
  const text = renderText(result, { text: "Bullish pullback, watching support.", source: "template" });
  assert.match(text, /Bullish pullback, watching support\./);
});

test("renderText handles null target2 and rr gracefully", () => {
  const result = buildResult({ plan: Object.assign({}, buildResult().plan, { target1: null, target2: null, rr: null }) });
  const text = renderText(result);
  assert.match(text, /Target:\nn\/a/);
  assert.match(text, /R:R:\nn\/a/);
});

test("renderScanLine format", () => {
  const result = buildResult();
  const line = renderScanLine(result);
  assert.equal(line, "SOLUSDT  LONG  WATCH  conf 82  rr 2.31  entry 118.20-119.10");
});

test("renderScanLine handles null rr", () => {
  const result = buildResult({ plan: Object.assign({}, buildResult().plan, { rr: null }) });
  const line = renderScanLine(result);
  assert.match(line, /rr n\/a/);
});
