"use strict";
/**
 * Orchestrator. Per SPEC §8.
 * analyze(symbol, {provider, saveRun=true}) -> fetches a Snapshot then runs analyzeSnapshot.
 * analyzeSnapshot(snapshot) is pure (no network) so tests/other modules can reuse it.
 */
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");
loadEnv();

const { decimalsFromTick } = require("./lib/kline-indicators");
const { computeIndicators, last } = require("./analysis/indicators");
const { findSwings, computeTrend, computeRange } = require("./analysis/structure");
const { computeSnr } = require("./analysis/snr");
const { pickDirection, buildPlan } = require("./analysis/plan");
const { computeConfluence } = require("./analysis/confluence");
const { evaluateGate } = require("./risk/gate");

const CONFIG = {
  DEFAULT_PRICE_DECIMALS: 2,
  PRICE_CHANGE_LOOKBACK_1H: 24, // bars back for 24h price change
  RUNS_DIR: path.join(__dirname, "..", "runs"),
};

function round(v, decimals) {
  if (v === null || v === undefined || isNaN(v)) return v;
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

function roundZone(zone, decimals) {
  if (!zone) return null;
  return { level: round(zone.level, decimals), zoneLow: round(zone.zoneLow, decimals), zoneHigh: round(zone.zoneHigh, decimals), weight: round(zone.weight, 4), touches: zone.touches, score: round(zone.score, 4) };
}

function regimeFor(trend4hLabel, distanceAtr) {
  if (trend4hLabel === "neutral") return "Range";
  const cap = trend4hLabel === "bullish" ? "Bullish" : "Bearish";
  if (distanceAtr === null || distanceAtr === undefined || isNaN(distanceAtr)) return cap;
  return cap + (distanceAtr > 0.5 ? " Pullback" : " At Level");
}

/**
 * Pure analysis: Snapshot -> Result. No network calls.
 * @param {object} snapshot
 * @returns {object} Result
 */
function analyzeSnapshot(snapshot) {
  // Drop the still-forming last candle: partial turnover would poison volume Z and EMAs.
  const asOf = Date.parse(snapshot.fetchedAt) || Date.now();
  const closed = (kl) => (kl.length && kl[kl.length - 1].closeTime > asOf ? kl.slice(0, -1) : kl);
  const kl4h = closed(snapshot.klines["4h"]);
  const kl1h = closed(snapshot.klines["1h"]);
  const price = snapshot.price;
  const decimals = decimalsFromTick(snapshot.tickSize) || CONFIG.DEFAULT_PRICE_DECIMALS;

  const indicators = computeIndicators(kl4h, kl1h);
  const swings4h = findSwings(kl4h);
  const swings1h = findSwings(kl1h);
  const trend4h = computeTrend(kl4h, indicators["4h"], swings4h);
  const trend1h = computeTrend(kl1h, indicators["1h"], swings1h);
  const { range, breakout, breakdown } = computeRange(kl4h);

  const atr4h = indicators["4h"].atr14;
  const atr1h = indicators["1h"].atr14;
  const snr = computeSnr(swings4h, swings1h, kl1h, kl4h, range, atr4h, price);

  const direction = pickDirection(trend4h, trend1h);
  const plan = buildPlan(direction, snr, indicators, price);

  // 24h price change from 1h klines (fallback null if not enough history).
  const idx24 = kl1h.length - 1 - CONFIG.PRICE_CHANGE_LOOKBACK_1H;
  const priceChangePct24h = idx24 >= 0 ? ((price - kl1h[idx24].close) / kl1h[idx24].close) * 100 : null;
  const oiChangePct =
    snapshot.oi && snapshot.oi.series && snapshot.oi.series.length >= 2 && snapshot.oi.series[0].oi
      ? ((snapshot.oi.series[snapshot.oi.series.length - 1].oi - snapshot.oi.series[0].oi) / snapshot.oi.series[0].oi) * 100
      : null;

  const confluence = computeConfluence(direction, {
    trend4h,
    trend1h,
    snr,
    indicators,
    price,
    volZ: indicators.volZ,
    oi: snapshot.oi,
    funding: snapshot.funding,
    spreadBps: snapshot.book.spreadBps,
    rr: plan.rr,
    priceChangePct24h,
  });

  const fundingFactor = confluence.factors.funding;
  const gate = evaluateGate({
    direction,
    hasZone: direction === "LONG" ? !!snr.support : direction === "SHORT" ? !!snr.resistance : false,
    rr: plan.rr,
    spreadBps: snapshot.book.spreadBps,
    distanceAtr: plan.distanceAtr,
    trend4h: trend4h.label,
    trend1h: trend1h.label,
    fundingCrowded: !!fundingFactor.crowded,
    confluenceScore: confluence.score,
    lowCoverage: confluence.lowCoverage,
  });

  const regime = regimeFor(trend4h.label, plan.distanceAtr);

  const result = {
    symbol: snapshot.symbol,
    generatedAt: new Date().toISOString(),
    source: snapshot.source,
    price: round(price, decimals),
    regime,
    trend: { "4h": trend4h, "1h": trend1h },
    structure: {
      swings4h,
      swings1h,
      range: { rangeHigh: round(range.rangeHigh, decimals), rangeLow: round(range.rangeLow, decimals) },
      breakout,
      breakdown,
    },
    snr: {
      support: roundZone(snr.support, decimals),
      resistance: roundZone(snr.resistance, decimals),
      supports: snr.supports.map((z) => roundZone(z, decimals)),
      resistances: snr.resistances.map((z) => roundZone(z, decimals)),
    },
    plan: {
      direction: plan.direction,
      entryZone: plan.entryZone ? plan.entryZone.map((v) => round(v, decimals)) : null,
      entry: round(plan.entry, decimals),
      invalidation: round(plan.invalidation, decimals),
      target1: round(plan.target1, decimals),
      target2: round(plan.target2, decimals),
      rr: round(plan.rr, 2),
      distanceAtr: round(plan.distanceAtr, 3),
    },
    confluence: {
      score: round(confluence.score, 1),
      availWeight: round(confluence.availWeight, 3),
      lowCoverage: confluence.lowCoverage,
      factors: confluence.factors,
    },
    gate,
    decision: gate.decision,
    raw: {
      decimals,
      atr4h: round(atr4h, decimals),
      atr1h: round(atr1h, decimals),
      volZ: round(indicators.volZ, 3),
      spreadBps: round(snapshot.book.spreadBps, 3),
      funding: snapshot.funding,
      oiChangePct: round(oiChangePct, 3),
      priceChangePct24h: round(priceChangePct24h, 3),
    },
  };

  return result;
}

async function analyze(symbol, opts) {
  opts = opts || {};
  const provider = opts.provider || require("./binance/restProvider");
  const saveRun = opts.saveRun !== undefined ? opts.saveRun : true;

  const snapshot = await provider.getSnapshot(symbol);
  const result = analyzeSnapshot(snapshot);

  if (saveRun) {
    try {
      fs.mkdirSync(CONFIG.RUNS_DIR, { recursive: true });
      const fname = `${symbol}-${result.generatedAt.replace(/:/g, "-")}.json`;
      fs.writeFileSync(path.join(CONFIG.RUNS_DIR, fname), JSON.stringify({ snapshot, result }, null, 2));
    } catch (e) {
      // audit trail is best-effort; never let it break analysis
    }
  }

  return result;
}

module.exports = { analyze, analyzeSnapshot };
