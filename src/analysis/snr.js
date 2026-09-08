"use strict";
/**
 * Support / Resistance clustering. Per SPEC §4.
 * Candidates: 4h swings (w=2.0), 1h swings (w=1.0), previous UTC day high/low (w=1.5),
 * current 30-bar 4h range high/low (w=1.0). Age decay 0.98^ageIn4hBars (by timestamp).
 * Greedy merge while |price - clusterMean| <= 0.5*atr4h. Min zone width 0.25*atr4h.
 */
const CONFIG = {
  WEIGHT_4H_SWING: 2.0,
  WEIGHT_1H_SWING: 1.0,
  WEIGHT_PREV_DAY: 1.5,
  WEIGHT_RANGE: 1.0,
  AGE_DECAY: 0.98,
  CLUSTER_ATR_MULT: 0.5,
  MIN_ZONE_ATR_MULT: 0.25,
  MAX_LEVELS: 3,
  MS_4H: 4 * 3600 * 1000,
};

// Previous full UTC day's high/low from 1h klines.
function prevUtcDayHighLow(kl1h) {
  if (!kl1h || !kl1h.length) return null;
  const lastTs = kl1h[kl1h.length - 1].openTime;
  const dayMs = 24 * 3600 * 1000;
  const startOfCurrentDay = Math.floor(lastTs / dayMs) * dayMs;
  const startOfPrevDay = startOfCurrentDay - dayMs;
  const bars = kl1h.filter((k) => k.openTime >= startOfPrevDay && k.openTime < startOfCurrentDay);
  if (!bars.length) return null;
  return {
    high: Math.max(...bars.map((k) => k.high)),
    low: Math.min(...bars.map((k) => k.low)),
    ts: startOfPrevDay,
  };
}

// Build weighted candidate levels from all sources.
function buildCandidates(swings4h, swings1h, kl1h, range4h, latestTs4h) {
  const candidates = [];
  const ageWeight = (baseWeight, ts) => {
    const ageIn4hBars = Math.max(0, (latestTs4h - ts) / CONFIG.MS_4H);
    return baseWeight * Math.pow(CONFIG.AGE_DECAY, ageIn4hBars);
  };

  swings4h.forEach((s) => {
    candidates.push({ price: s.price, weight: ageWeight(CONFIG.WEIGHT_4H_SWING, s.ts), ts: s.ts, src: "4h-swing" });
  });
  swings1h.forEach((s) => {
    candidates.push({ price: s.price, weight: ageWeight(CONFIG.WEIGHT_1H_SWING, s.ts), ts: s.ts, src: "1h-swing" });
  });

  const prevDay = prevUtcDayHighLow(kl1h);
  if (prevDay) {
    candidates.push({ price: prevDay.high, weight: ageWeight(CONFIG.WEIGHT_PREV_DAY, prevDay.ts), ts: prevDay.ts, src: "prevDayHigh" });
    candidates.push({ price: prevDay.low, weight: ageWeight(CONFIG.WEIGHT_PREV_DAY, prevDay.ts), ts: prevDay.ts, src: "prevDayLow" });
  }

  candidates.push({ price: range4h.rangeHigh, weight: ageWeight(CONFIG.WEIGHT_RANGE, latestTs4h), ts: latestTs4h, src: "rangeHigh" });
  candidates.push({ price: range4h.rangeLow, weight: ageWeight(CONFIG.WEIGHT_RANGE, latestTs4h), ts: latestTs4h, src: "rangeLow" });

  return candidates;
}

// Greedy merge sorted-by-price candidates while within tolerance of the running cluster mean.
function clusterLevels(candidates, atr4h) {
  if (!candidates.length) return [];
  const tol = CONFIG.CLUSTER_ATR_MULT * atr4h;
  const sorted = candidates.slice().sort((a, b) => a.price - b.price);
  const clusters = [];
  let cur = null;
  sorted.forEach((c) => {
    if (cur) {
      const mean = cur.sumWP / cur.sumW;
      if (Math.abs(c.price - mean) <= tol) {
        cur.sumWP += c.price * c.weight;
        cur.sumW += c.weight;
        cur.touches++;
        cur.min = Math.min(cur.min, c.price);
        cur.max = Math.max(cur.max, c.price);
        return;
      }
      clusters.push(cur);
    }
    cur = { sumWP: c.price * c.weight, sumW: c.weight, touches: 1, min: c.price, max: c.price };
  });
  if (cur) clusters.push(cur);

  const minWidth = CONFIG.MIN_ZONE_ATR_MULT * atr4h;
  const maxWeight = Math.max(...clusters.map((c) => c.sumW));
  return clusters.map((c) => {
    const level = c.sumWP / c.sumW;
    let zoneLow = c.min;
    let zoneHigh = c.max;
    if (zoneHigh - zoneLow < minWidth) {
      const pad = (minWidth - (zoneHigh - zoneLow)) / 2;
      zoneLow -= pad;
      zoneHigh += pad;
    }
    return { level, zoneLow, zoneHigh, weight: c.sumW, touches: c.touches, score: c.sumW / maxWeight };
  });
}

function computeSnr(swings4h, swings1h, kl1h, kl4h, range4h, atr4h, price) {
  const latestTs4h = kl4h.length ? kl4h[kl4h.length - 1].openTime : 0;
  const candidates = buildCandidates(swings4h, swings1h, kl1h, range4h, latestTs4h);
  const clusters = clusterLevels(candidates, atr4h).sort((a, b) => a.level - b.level);

  const belowPrice = clusters.filter((c) => c.level < price).sort((a, b) => b.level - a.level);
  const abovePrice = clusters.filter((c) => c.level > price).sort((a, b) => a.level - b.level);

  return {
    support: belowPrice[0] || null,
    resistance: abovePrice[0] || null,
    supports: belowPrice.slice(0, CONFIG.MAX_LEVELS),
    resistances: abovePrice.slice(0, CONFIG.MAX_LEVELS),
  };
}

module.exports = { computeSnr, prevUtcDayHighLow, buildCandidates, clusterLevels, CONFIG };
