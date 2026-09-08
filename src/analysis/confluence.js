"use strict";
/**
 * Confluence scoring. Per SPEC §6. Each factor -> {val:0..100|null, weight, note, status}.
 * Weighted average via lib/weighted-available (missing data drops out of the denominator,
 * never treated as 0 or 50). Weights are fractions of 1.0.
 */
const { weightedAvailable } = require("../lib/weighted-available");
const { last } = require("./indicators");

const CONFIG = {
  WEIGHTS: { htf: 0.25, snr: 0.20, vegas: 0.15, volume: 0.15, oi: 0.10, funding: 0.05, liquidity: 0.05, rr: 0.05 },
  LOW_COVERAGE_MAX: 0.7,
  HTF_ALIGNED_4H: 72,
  HTF_ALIGNED_1H_BONUS: 28,
  HTF_NEUTRAL: 40,
  HTF_AGAINST: 0,
  VEGAS_NEAR_ATR_MULT: 0.5,
  VEGAS_SLOPE_LOOKBACK: 12,
  VEGAS_ALIGNED_NEAR: 100,
  VEGAS_ALIGNED_FAR: 55,
  VEGAS_AGAINST: 0,
  VOLZ_HIGH: 1,
  VOLZ_LOW: -1,
  VOL_SCORE_HIGH: 100,
  VOL_SCORE_MID_POS: 65,
  VOL_SCORE_MID_NEG: 40,
  VOL_SCORE_LOW: 20,
  OI_UP_WITH: 100,
  OI_UP_AGAINST: 40,
  OI_DOWN: 60,
  FUNDING_T1: 0.0001,
  FUNDING_T2: 0.0003,
  FUNDING_T3: 0.0005,
  FUNDING_S1: 100,
  FUNDING_S2: 60,
  FUNDING_S3: 20,
  FUNDING_S4: 0,
  SPREAD_T1: 2,
  SPREAD_T2: 5,
  SPREAD_T3: 10,
  SPREAD_S1: 100,
  SPREAD_S2: 60,
  SPREAD_S3: 20,
  SPREAD_S4: 0,
  RR_T1: 3,
  RR_T2: 2.5,
  RR_T3: 2,
  RR_T4: 1.8,
  RR_S1: 100,
  RR_S2: 80,
  RR_S3: 60,
  RR_S4: 40,
  RR_S5: 0,
};

const isLong = (direction) => direction === "LONG";

function htfFactor(direction, trend4h, trend1h) {
  const aligned4h = (direction === "LONG" && trend4h.label === "bullish") || (direction === "SHORT" && trend4h.label === "bearish");
  const aligned1h = (direction === "LONG" && trend1h.label === "bullish") || (direction === "SHORT" && trend1h.label === "bearish");
  let val;
  let note;
  if (aligned4h) {
    val = CONFIG.HTF_ALIGNED_4H + (aligned1h ? CONFIG.HTF_ALIGNED_1H_BONUS : 0);
    note = aligned1h ? "4h & 1h aligned" : "4h aligned, 1h not";
  } else if (trend4h.label === "neutral") {
    val = CONFIG.HTF_NEUTRAL;
    note = "4h neutral";
  } else {
    val = CONFIG.HTF_AGAINST;
    note = "4h against direction";
  }
  return { val, weight: CONFIG.WEIGHTS.htf, note, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function snrFactor(direction, snr) {
  const zone = isLong(direction) ? snr.support : snr.resistance;
  if (!zone) return { val: null, weight: CONFIG.WEIGHTS.snr, note: "no zone", status: "na" };
  const val = zone.score * 100;
  return { val, weight: CONFIG.WEIGHTS.snr, note: `zone score ${zone.score.toFixed(2)}`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function vegasFactor(direction, price, ind1h, atr1h) {
  const ema144 = ind1h.ema144;
  const ema169 = ind1h.ema169;
  const cur144 = last(ema144);
  const cur169 = last(ema169);
  const lookbackIdx = ema144.length - 1 - CONFIG.VEGAS_SLOPE_LOOKBACK;
  const prior144 = lookbackIdx >= 0 ? ema144[lookbackIdx] : null;
  if (cur144 === null || cur169 === null || prior144 === null || atr1h === null) {
    return { val: null, weight: CONFIG.WEIGHTS.vegas, note: "insufficient data", status: "na" };
  }
  const slopeUp = cur144 > prior144;
  const slopeAligned = isLong(direction) ? slopeUp : !slopeUp;
  const channelLow = Math.min(cur144, cur169);
  const channelHigh = Math.max(cur144, cur169);
  const dist = price < channelLow ? channelLow - price : price > channelHigh ? price - channelHigh : 0;
  const near = dist <= CONFIG.VEGAS_NEAR_ATR_MULT * atr1h;
  let val;
  if (!slopeAligned) val = CONFIG.VEGAS_AGAINST;
  else val = near ? CONFIG.VEGAS_ALIGNED_NEAR : CONFIG.VEGAS_ALIGNED_FAR;
  return { val, weight: CONFIG.WEIGHTS.vegas, note: `slope ${slopeAligned ? "aligned" : "against"}, ${near ? "near" : "far"}`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function volumeFactor(volZ) {
  if (volZ === null || volZ === undefined) return { val: null, weight: CONFIG.WEIGHTS.volume, note: "no data", status: "na" };
  let val;
  if (volZ >= CONFIG.VOLZ_HIGH) val = CONFIG.VOL_SCORE_HIGH;
  else if (volZ >= 0) val = CONFIG.VOL_SCORE_MID_POS;
  else if (volZ >= CONFIG.VOLZ_LOW) val = CONFIG.VOL_SCORE_MID_NEG;
  else val = CONFIG.VOL_SCORE_LOW;
  return { val, weight: CONFIG.WEIGHTS.volume, note: `volZ ${volZ.toFixed(2)}`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function oiFactor(direction, oi, priceChangePct24h) {
  if (!oi || !oi.series || oi.series.length < 2 || priceChangePct24h === null) {
    return { val: null, weight: CONFIG.WEIGHTS.oi, note: "no data", status: "na" };
  }
  const first = oi.series[0].oi;
  const lastOi = oi.series[oi.series.length - 1].oi;
  const oiChangePct = first ? ((lastOi - first) / first) * 100 : null;
  if (oiChangePct === null) return { val: null, weight: CONFIG.WEIGHTS.oi, note: "no data", status: "na" };
  const priceInDirection = isLong(direction) ? priceChangePct24h > 0 : priceChangePct24h < 0;
  let val;
  if (oiChangePct > 0) val = priceInDirection ? CONFIG.OI_UP_WITH : CONFIG.OI_UP_AGAINST;
  else val = CONFIG.OI_DOWN;
  return { val, weight: CONFIG.WEIGHTS.oi, note: `OI ${oiChangePct.toFixed(1)}%`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function fundingFactor(direction, funding) {
  if (!funding || funding.rate === null || funding.rate === undefined) {
    return { val: null, weight: CONFIG.WEIGHTS.funding, note: "no data", status: "na", crowded: false };
  }
  const r = isLong(direction) ? funding.rate : -funding.rate;
  let val;
  if (r <= CONFIG.FUNDING_T1) val = CONFIG.FUNDING_S1;
  else if (r <= CONFIG.FUNDING_T2) val = CONFIG.FUNDING_S2;
  else if (r <= CONFIG.FUNDING_T3) val = CONFIG.FUNDING_S3;
  else val = CONFIG.FUNDING_S4;
  const crowded = val === CONFIG.FUNDING_S4;
  return { val, weight: CONFIG.WEIGHTS.funding, note: `rate ${r.toFixed(5)}`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad", crowded };
}

function liquidityFactor(spreadBps) {
  if (spreadBps === null || spreadBps === undefined) return { val: null, weight: CONFIG.WEIGHTS.liquidity, note: "no data", status: "na" };
  let val;
  if (spreadBps <= CONFIG.SPREAD_T1) val = CONFIG.SPREAD_S1;
  else if (spreadBps <= CONFIG.SPREAD_T2) val = CONFIG.SPREAD_S2;
  else if (spreadBps <= CONFIG.SPREAD_T3) val = CONFIG.SPREAD_S3;
  else val = CONFIG.SPREAD_S4;
  return { val, weight: CONFIG.WEIGHTS.liquidity, note: `spread ${spreadBps.toFixed(2)}bps`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function rrFactor(rr) {
  if (rr === null || rr === undefined) return { val: null, weight: CONFIG.WEIGHTS.rr, note: "no data", status: "na" };
  let val;
  if (rr >= CONFIG.RR_T1) val = CONFIG.RR_S1;
  else if (rr >= CONFIG.RR_T2) val = CONFIG.RR_S2;
  else if (rr >= CONFIG.RR_T3) val = CONFIG.RR_S3;
  else if (rr >= CONFIG.RR_T4) val = CONFIG.RR_S4;
  else val = CONFIG.RR_S5;
  return { val, weight: CONFIG.WEIGHTS.rr, note: `rr ${rr.toFixed(2)}`, status: val >= 70 ? "ok" : val >= 40 ? "warn" : "bad" };
}

function computeConfluence(direction, ctx) {
  const { trend4h, trend1h, snr, indicators, price, volZ, oi, funding, spreadBps, rr, priceChangePct24h } = ctx;
  const factors = {
    htf: htfFactor(direction, trend4h, trend1h),
    snr: snrFactor(direction, snr),
    vegas: vegasFactor(direction, price, indicators["1h"], indicators["1h"].atr14),
    volume: volumeFactor(volZ),
    oi: oiFactor(direction, oi, priceChangePct24h),
    funding: fundingFactor(direction, funding),
    liquidity: liquidityFactor(spreadBps),
    rr: rrFactor(rr),
  };
  const { score, availWeight } = weightedAvailable(Object.values(factors).map((f) => ({ val: f.val, weight: f.weight })));
  return { score, availWeight, lowCoverage: availWeight < CONFIG.LOW_COVERAGE_MAX, factors };
}

module.exports = { computeConfluence, CONFIG };
