"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { pickDirection, buildPlan } = require("../src/analysis/plan");

test("pickDirection: 4h bullish -> LONG, 4h bearish -> SHORT, 4h neutral follows 1h, else NONE", () => {
  assert.strictEqual(pickDirection({ label: "bullish" }, { label: "bearish" }), "LONG");
  assert.strictEqual(pickDirection({ label: "bearish" }, { label: "bullish" }), "SHORT");
  assert.strictEqual(pickDirection({ label: "neutral" }, { label: "bullish" }), "LONG");
  assert.strictEqual(pickDirection({ label: "neutral" }, { label: "bearish" }), "SHORT");
  assert.strictEqual(pickDirection({ label: "neutral" }, { label: "neutral" }), "NONE");
});

test("buildPlan LONG: known support/resistance -> exact rr and levels", () => {
  const snr = {
    support: { zoneLow: 100, zoneHigh: 102 },
    resistance: { zoneLow: 108, zoneHigh: 110 },
    resistances: [{ level: 110 }, { level: 120 }],
    supports: [{ level: 102 }],
  };
  const indicators = { "4h": { atr14: 2 }, "1h": { atr14: 1 } };
  const price = 103;
  const plan = buildPlan("LONG", snr, indicators, price);
  assert.strictEqual(plan.entry, 102);
  assert.strictEqual(plan.invalidation, 99.5); // 100 - 0.5*1
  assert.strictEqual(plan.target1, 110); // 110-102=8 >= 1*atr4h(2)
  assert.strictEqual(plan.target2, 120);
  assert.strictEqual(plan.rr, (110 - 102) / (102 - 99.5));
  assert.strictEqual(plan.distanceAtr, (103 - 102) / 2);
});

test("buildPlan SHORT: mirror of LONG using resistance as entry zone", () => {
  const snr = {
    support: { zoneLow: 90, zoneHigh: 92 },
    resistance: { zoneLow: 108, zoneHigh: 110 },
    supports: [{ level: 92 }, { level: 80 }],
    resistances: [{ level: 110 }],
  };
  const indicators = { "4h": { atr14: 2 }, "1h": { atr14: 1 } };
  const price = 107;
  const plan = buildPlan("SHORT", snr, indicators, price);
  assert.strictEqual(plan.entry, 108); // resistance.zoneLow
  assert.strictEqual(plan.invalidation, 110.5); // 110 + 0.5*1
  assert.strictEqual(plan.target1, 92); // 108-92=16 >= 1*atr4h(2)
  assert.strictEqual(plan.rr, (108 - 92) / (110.5 - 108));
  assert.strictEqual(plan.distanceAtr, (108 - 107) / 2);
});

test("buildPlan: rr null when no target far enough away", () => {
  const snr = { support: { zoneLow: 100, zoneHigh: 102 }, resistance: null, resistances: [{ level: 102.5 }], supports: [] };
  const indicators = { "4h": { atr14: 2 }, "1h": { atr14: 1 } };
  const plan = buildPlan("LONG", snr, indicators, 103);
  assert.strictEqual(plan.target1, null);
  assert.strictEqual(plan.rr, null);
});

test("buildPlan: NONE direction -> all nulls", () => {
  const plan = buildPlan("NONE", {}, { "4h": { atr14: 1 }, "1h": { atr14: 1 } }, 100);
  assert.strictEqual(plan.entry, null);
  assert.strictEqual(plan.rr, null);
});
