"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { weightedAvailable } = require("../src/lib/weighted-available");
const { CONFIG } = require("../src/analysis/confluence");

test("weightedAvailable coverage: missing funding+oi -> availWeight 0.85", () => {
  const w = CONFIG.WEIGHTS;
  const parts = [
    { val: 80, weight: w.htf },
    { val: 80, weight: w.snr },
    { val: 80, weight: w.vegas },
    { val: 80, weight: w.volume },
    { val: null, weight: w.oi }, // missing
    { val: null, weight: w.funding }, // missing
    { val: 80, weight: w.liquidity },
    { val: 80, weight: w.rr },
  ];
  const { availWeight, score } = weightedAvailable(parts);
  assert.ok(Math.abs(availWeight - 0.85) < 1e-9, `expected 0.85, got ${availWeight}`);
  assert.ok(Math.abs(score - 80) < 1e-9); // all available parts equal -> score unaffected by renormalization
});

test("weightedAvailable: all missing -> score null, availWeight 0", () => {
  const { score, availWeight } = weightedAvailable([{ val: null, weight: 1 }]);
  assert.strictEqual(score, null);
  assert.strictEqual(availWeight, 0);
});
