"use strict";
/**
 * Direction & trade plan. Per SPEC §5. SHORT is a true mirror of LONG
 * (resistance plays the role of support, targets come from supports[]).
 */
const CONFIG = {
  INVALIDATION_ATR_MULT: 0.5, // x atr14(1h)
  TARGET_MIN_ATR_MULT: 1.0, // x atr4h, minimum distance entry->target1
};

function pickDirection(trend4h, trend1h) {
  if (trend4h.label === "bullish") return "LONG";
  if (trend4h.label === "bearish") return "SHORT";
  if (trend1h.label === "bullish") return "LONG";
  if (trend1h.label === "bearish") return "SHORT";
  return "NONE";
}

// Nearest zone (by |level - entry| ascending among those far enough) and the following one.
function pickTargets(entry, zones, atr4h, farEnoughFn) {
  const eligible = zones.filter((z) => farEnoughFn(z));
  const target1 = eligible[0] || null;
  const target2 = eligible[1] || null;
  return { target1, target2 };
}

function buildPlan(direction, snr, indicators, price) {
  const atr4h = indicators["4h"].atr14;
  const atr1h = indicators["1h"].atr14;

  if (direction === "NONE") {
    return { direction, entryZone: null, entry: null, invalidation: null, target1: null, target2: null, rr: null, distanceAtr: null };
  }

  if (direction === "LONG") {
    const support = snr.support;
    if (!support) {
      return { direction, entryZone: null, entry: null, invalidation: null, target1: null, target2: null, rr: null, distanceAtr: null };
    }
    const entry = support.zoneHigh;
    const invalidation = support.zoneLow - CONFIG.INVALIDATION_ATR_MULT * atr1h;
    const { target1, target2 } = pickTargets(entry, snr.resistances, atr4h, (z) => z.level - entry >= CONFIG.TARGET_MIN_ATR_MULT * atr4h);
    const rr = target1 ? (target1.level - entry) / (entry - invalidation) : null;
    const distanceAtr = (price - entry) / atr4h;
    return {
      direction,
      entryZone: [support.zoneLow, support.zoneHigh],
      entry,
      invalidation,
      target1: target1 ? target1.level : null,
      target2: target2 ? target2.level : null,
      rr,
      distanceAtr,
    };
  }

  // SHORT mirror: resistance plays support's role, supports[] play resistances[]'s role.
  const resistance = snr.resistance;
  if (!resistance) {
    return { direction, entryZone: null, entry: null, invalidation: null, target1: null, target2: null, rr: null, distanceAtr: null };
  }
  const entry = resistance.zoneLow;
  const invalidation = resistance.zoneHigh + CONFIG.INVALIDATION_ATR_MULT * atr1h;
  const { target1, target2 } = pickTargets(entry, snr.supports, atr4h, (z) => entry - z.level >= CONFIG.TARGET_MIN_ATR_MULT * atr4h);
  const rr = target1 ? (entry - target1.level) / (invalidation - entry) : null;
  const distanceAtr = (entry - price) / atr4h;
  return {
    direction,
    entryZone: [resistance.zoneLow, resistance.zoneHigh],
    entry,
    invalidation,
    target1: target1 ? target1.level : null,
    target2: target2 ? target2.level : null,
    rr,
    distanceAtr,
  };
}

module.exports = { pickDirection, buildPlan, CONFIG };
