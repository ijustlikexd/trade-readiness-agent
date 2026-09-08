"use strict";
/**
 * Risk gate. Per SPEC §7. Hard rules evaluated in order, first hit wins -> NO TRADE.
 * Soft rules accumulate -> WATCH. Then confluence.score < 50 downgrades to NO TRADE.
 */
const CONFIG = {
  SPREAD_MAX_BPS: 10,
  RR_MIN: 1.8,
  DISTANCE_ATR_HARD_MAX: 1.5,
  DISTANCE_ATR_WATCH: 0.5,
  CONFLUENCE_WATCH_MIN: 70,
  CONFLUENCE_HARD_MIN: 50,
};

/**
 * @param {object} ctx
 * @param {"LONG"|"SHORT"|"NONE"} ctx.direction
 * @param {boolean} ctx.hasZone - support present (LONG) / resistance present (SHORT)
 * @param {number|null} ctx.rr
 * @param {number|null} ctx.spreadBps
 * @param {number|null} ctx.distanceAtr
 * @param {string} ctx.trend4h - "bullish"|"bearish"|"neutral"
 * @param {string} ctx.trend1h
 * @param {boolean} ctx.fundingCrowded
 * @param {number|null} ctx.confluenceScore
 * @param {boolean} ctx.lowCoverage
 */
function evaluateGate(ctx) {
  const hardReasons = [];

  if (ctx.direction === "NONE") {
    hardReasons.push("direction is NONE");
  } else if (!ctx.hasZone) {
    hardReasons.push(ctx.direction === "LONG" ? "no support zone" : "no resistance zone");
  } else if (ctx.rr === null) {
    hardReasons.push("rr is null (no valid target)");
  } else if (ctx.spreadBps !== null && ctx.spreadBps > CONFIG.SPREAD_MAX_BPS) {
    hardReasons.push(`spread ${ctx.spreadBps.toFixed(2)}bps > ${CONFIG.SPREAD_MAX_BPS}bps`);
  } else if (ctx.rr < CONFIG.RR_MIN) {
    hardReasons.push(`rr ${ctx.rr.toFixed(2)} < ${CONFIG.RR_MIN}`);
  } else if (ctx.distanceAtr !== null && ctx.distanceAtr > CONFIG.DISTANCE_ATR_HARD_MAX) {
    hardReasons.push(`distanceAtr ${ctx.distanceAtr.toFixed(2)} > ${CONFIG.DISTANCE_ATR_HARD_MAX}`);
  }

  if (hardReasons.length) {
    return { decision: "NO TRADE", hardReasons, watchReasons: [] };
  }

  const watchReasons = [];
  if (
    (ctx.trend4h === "bullish" && ctx.trend1h === "bearish") ||
    (ctx.trend4h === "bearish" && ctx.trend1h === "bullish")
  ) {
    watchReasons.push("4h/1h trend conflict");
  }
  if (ctx.trend4h === "neutral" && ctx.direction !== "NONE") {
    watchReasons.push("HTF neutral: direction from 1h only");
  }
  if (ctx.fundingCrowded) watchReasons.push("funding crowded");
  if (ctx.distanceAtr !== null && ctx.distanceAtr > CONFIG.DISTANCE_ATR_WATCH) {
    watchReasons.push("waiting for pullback");
  }
  if (ctx.confluenceScore !== null && ctx.confluenceScore < CONFIG.CONFLUENCE_WATCH_MIN) {
    watchReasons.push(`confluence ${ctx.confluenceScore.toFixed(1)} < ${CONFIG.CONFLUENCE_WATCH_MIN}`);
  }
  if (ctx.lowCoverage) watchReasons.push("low data coverage");

  let decision = watchReasons.length ? "WATCH" : "TRADE READY";

  if (ctx.confluenceScore !== null && ctx.confluenceScore < CONFIG.CONFLUENCE_HARD_MIN) {
    decision = "NO TRADE";
    hardReasons.push("confluence too low");
  }

  return { decision, hardReasons, watchReasons };
}

module.exports = { evaluateGate, CONFIG };
