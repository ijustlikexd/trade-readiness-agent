"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { evaluateGate } = require("../src/risk/gate");

// A baseline ctx that should produce TRADE READY, then each test flips one field.
function baseCtx(overrides) {
  return Object.assign(
    {
      direction: "LONG",
      hasZone: true,
      rr: 3,
      spreadBps: 1,
      distanceAtr: 0.1,
      trend4h: "bullish",
      trend1h: "bullish",
      fundingCrowded: false,
      confluenceScore: 80,
      lowCoverage: false,
    },
    overrides
  );
}

test("gate: baseline -> TRADE READY", () => {
  const g = evaluateGate(baseCtx());
  assert.strictEqual(g.decision, "TRADE READY");
  assert.deepStrictEqual(g.hardReasons, []);
  assert.deepStrictEqual(g.watchReasons, []);
});

test("gate rule 1: direction NONE -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ direction: "NONE" }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 2: no zone -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ hasZone: false }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 3: rr null -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ rr: null }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 4: spread > 10bps -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ spreadBps: 11 }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 5: rr < 1.8 -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ rr: 1.5 }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 6: distanceAtr > 1.5 -> NO TRADE", () => {
  const g = evaluateGate(baseCtx({ distanceAtr: 2 }));
  assert.strictEqual(g.decision, "NO TRADE");
});

test("gate rule 7: 4h/1h trend conflict -> WATCH", () => {
  const g = evaluateGate(baseCtx({ trend1h: "bearish" }));
  assert.strictEqual(g.decision, "WATCH");
  assert.ok(g.watchReasons.some((r) => r.includes("conflict")));
});

test("gate rule 8: funding crowded -> WATCH", () => {
  const g = evaluateGate(baseCtx({ fundingCrowded: true }));
  assert.strictEqual(g.decision, "WATCH");
});

test("gate rule 9: distanceAtr > 0.5 -> WATCH (waiting for pullback)", () => {
  const g = evaluateGate(baseCtx({ distanceAtr: 0.8 }));
  assert.strictEqual(g.decision, "WATCH");
  assert.ok(g.watchReasons.some((r) => r.includes("pullback")));
});

test("gate rule 10: confluence score < 70 -> WATCH", () => {
  const g = evaluateGate(baseCtx({ confluenceScore: 65 }));
  assert.strictEqual(g.decision, "WATCH");
});

test("gate rule 11: lowCoverage -> WATCH", () => {
  const g = evaluateGate(baseCtx({ lowCoverage: true }));
  assert.strictEqual(g.decision, "WATCH");
});

test("gate: confluence score < 50 downgrades to NO TRADE even with watch reasons", () => {
  const g = evaluateGate(baseCtx({ confluenceScore: 45, fundingCrowded: true }));
  assert.strictEqual(g.decision, "NO TRADE");
  assert.ok(g.hardReasons.includes("confluence too low"));
  assert.ok(g.watchReasons.length > 0); // watch reasons still recorded
});

test("gate: hard rule order - first hit wins (direction NONE beats everything else)", () => {
  const g = evaluateGate(baseCtx({ direction: "NONE", hasZone: false, rr: null, spreadBps: 50 }));
  assert.strictEqual(g.hardReasons.length, 1);
  assert.strictEqual(g.hardReasons[0], "direction is NONE");
});
