"use strict";
/**
 * Market structure: fractal swings, swing bias, trend classification, range/breakout.
 * Per SPEC §3.
 */
const { last } = require("./indicators");

const CONFIG = {
  SWING_N: 3, // bars each side for fractal confirmation
  TREND_BULLISH_MIN: 2,
  TREND_BEARISH_MAX: -2,
  RANGE_LOOKBACK: 30, // bars, 4h
};

/**
 * Fractal swings: bar i is a swing high if high[i] is strictly the max of high[i-n..i+n].
 * Mirror for lows. Bars within n of either edge cannot be confirmed.
 * @param {Array} kl oldest->newest
 * @param {number} [n]
 * @returns {Array<{idx, ts, price, kind:"H"|"L"}>}
 */
function findSwings(kl, n) {
  const win = n || CONFIG.SWING_N;
  const swings = [];
  for (let i = win; i < kl.length - win; i++) {
    const window = kl.slice(i - win, i + win + 1);
    const hi = Math.max(...window.map((k) => k.high));
    const lo = Math.min(...window.map((k) => k.low));
    if (kl[i].high === hi && window.filter((k) => k.high === hi).length === 1) {
      swings.push({ idx: i, ts: kl[i].openTime, price: kl[i].high, kind: "H" });
    }
    if (kl[i].low === lo && window.filter((k) => k.low === lo).length === 1) {
      swings.push({ idx: i, ts: kl[i].openTime, price: kl[i].low, kind: "L" });
    }
  }
  swings.sort((a, b) => a.idx - b.idx);
  return swings;
}

/**
 * Swing bias from the last 2 confirmed highs and last 2 lows.
 * HH && HL -> +1; LH && LL -> -1; else 0.
 */
function swingBias(swings) {
  const highs = swings.filter((s) => s.kind === "H").slice(-2);
  const lows = swings.filter((s) => s.kind === "L").slice(-2);
  if (highs.length < 2 || lows.length < 2) return 0;
  const hh = highs[1].price > highs[0].price;
  const lh = highs[1].price < highs[0].price;
  const hl = lows[1].price > lows[0].price;
  const ll = lows[1].price < lows[0].price;
  if (hh && hl) return 1;
  if (lh && ll) return -1;
  return 0;
}

/**
 * Trend for one TF = sum of (ema20>ema50 ? +1:-1) + (close>ema50 ? +1:-1) + swingBias.
 * >=2 bullish; <=-2 bearish; else neutral.
 */
function computeTrend(kl, tfIndicators, swings) {
  const ema20 = last(tfIndicators.ema20);
  const ema50 = last(tfIndicators.ema50);
  const close = last(kl.map((k) => k.close));
  const emaCross = ema20 > ema50 ? 1 : -1;
  const closeVsEma50 = close > ema50 ? 1 : -1;
  const bias = swingBias(swings);
  const score = emaCross + closeVsEma50 + bias;
  let label = "neutral";
  if (score >= CONFIG.TREND_BULLISH_MIN) label = "bullish";
  else if (score <= CONFIG.TREND_BEARISH_MAX) label = "bearish";
  return { label, score, emaCross, closeVsEma50, swingBias: bias };
}

/**
 * 4h range (last N bars) + breakout/breakdown flags vs the range excluding the last bar.
 */
function computeRange(kl4h) {
  const n = CONFIG.RANGE_LOOKBACK;
  const recent = kl4h.slice(-n);
  const rangeHigh = Math.max(...recent.map((k) => k.high));
  const rangeLow = Math.min(...recent.map((k) => k.low));

  const prevWindow = kl4h.slice(-n - 1, -1); // excludes current/last bar
  const prevHigh = prevWindow.length ? Math.max(...prevWindow.map((k) => k.high)) : rangeHigh;
  const prevLow = prevWindow.length ? Math.min(...prevWindow.map((k) => k.low)) : rangeLow;

  const currentClose = last(kl4h.map((k) => k.close));
  const breakout = currentClose > prevHigh;
  const breakdown = currentClose < prevLow;

  return { range: { rangeHigh, rangeLow }, breakout, breakdown };
}

module.exports = { findSwings, swingBias, computeTrend, computeRange, CONFIG };
