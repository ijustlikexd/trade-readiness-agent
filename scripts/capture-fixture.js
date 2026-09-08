"use strict";
/**
 * One-off: fetch real REST snapshots for BTCUSDT/ETHUSDT/SOLUSDT and save as test fixtures.
 * Run: node scripts/capture-fixture.js
 */
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../src/lib/env");
loadEnv();
const restProvider = require("../src/binance/restProvider");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const OUT_DIR = path.join(__dirname, "..", "tests", "fixtures");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const symbol of SYMBOLS) {
    console.log(`fetching ${symbol}...`);
    const snapshot = await restProvider.getSnapshot(symbol);
    const outPath = path.join(OUT_DIR, `${symbol}-snapshot.json`);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`wrote ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
