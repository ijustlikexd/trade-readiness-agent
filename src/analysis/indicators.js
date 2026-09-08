"use strict";
/**
 * Per-timeframe indicators: EMA20/EMA50 (both TFs), EMA144/EMA169 Vegas channel (1h only),
 * ATR14 per TF, volume robust-z (1h turnover). Per SPEC §2.
 */
const { ema, computeATR, computeVolumeRobustZ } = require("../lib/kline-indicators");

const CONFIG = {
  EMA_SHORT: 20,
  EMA_LONG: 50,
  VEGAS_FAST: 144,
  VEGAS_SLOW: 169,
  ATR_PERIOD: 14,
};

// Compute indicator arrays for one timeframe's klines (oldest->newest).
function computeTF(kl, { vegas = false } = {}) {
  const closes = kl.map((k) => k.close);
  const ema20 = ema(closes, CONFIG.EMA_SHORT);
  const ema50 = ema(closes, CONFIG.EMA_LONG);
  const { atr } = computeATR(kl, CONFIG.ATR_PERIOD);
  const out = { ema20, ema50, atr14: atr };
  if (vegas) {
    out.ema144 = ema(closes, CONFIG.VEGAS_FAST);
    out.ema169 = ema(closes, CONFIG.VEGAS_SLOW);
  }
  return out;
}

function last(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function computeIndicators(kl4h, kl1h) {
  return {
    "4h": computeTF(kl4h),
    "1h": computeTF(kl1h, { vegas: true }),
    volZ: computeVolumeRobustZ(kl1h),
  };
}

module.exports = { computeIndicators, last, CONFIG };
