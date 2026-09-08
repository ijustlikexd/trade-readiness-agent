"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { clusterLevels } = require("../src/analysis/snr");

test("clusterLevels: 3 close levels merge, 4th far level stays separate", () => {
  const atr4h = 1; // tolerance = 0.5 * atr4h = 0.5
  const candidates = [
    { price: 100, weight: 1 },
    { price: 100.2, weight: 1 },
    { price: 99.8, weight: 1 },
    { price: 110, weight: 1 },
  ];
  const clusters = clusterLevels(candidates, atr4h);
  assert.strictEqual(clusters.length, 2);
  const merged = clusters.find((c) => c.level < 105);
  const lone = clusters.find((c) => c.level >= 105);
  assert.strictEqual(merged.touches, 3);
  assert.strictEqual(lone.touches, 1);
  assert.ok(Math.abs(merged.level - 100) < 0.5);
  assert.strictEqual(lone.level, 110);
});

test("clusterLevels: min zone width expands to 0.25*atr4h", () => {
  const atr4h = 4; // min width = 1.0
  const candidates = [{ price: 100, weight: 1 }]; // single point -> zoneLow=zoneHigh=100
  const clusters = clusterLevels(candidates, atr4h);
  assert.strictEqual(clusters.length, 1);
  const width = clusters[0].zoneHigh - clusters[0].zoneLow;
  assert.ok(Math.abs(width - 1.0) < 1e-9);
});

test("clusterLevels: score is weight normalized by max cluster weight", () => {
  const atr4h = 1;
  const candidates = [
    { price: 100, weight: 3 },
    { price: 110, weight: 1 },
  ];
  const clusters = clusterLevels(candidates, atr4h).sort((a, b) => a.level - b.level);
  assert.strictEqual(clusters[0].score, 1); // highest weight cluster
  assert.ok(clusters[1].score < 1);
});
