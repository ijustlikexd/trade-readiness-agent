#!/usr/bin/env node
"use strict";
// CLI entrypoint. docs/SPEC.md §10.
//   node src/cli.js analyze SOLUSDT [--json] [--no-llm] [--provider rest|mcp]
//   node src/cli.js scan

const { loadEnv } = require("./lib/env");
loadEnv();

const { renderText, renderScanLine } = require("./output/report");
const { explain } = require("./agent/explain");

const SCAN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

function parseFlags(argv) {
  const flags = { json: false, noLlm: false, provider: null, symbol: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--no-llm") flags.noLlm = true;
    else if (a === "--provider") flags.provider = argv[++i];
    else if (!a.startsWith("--") && !flags.symbol) flags.symbol = a;
  }
  return flags;
}

function getAnalyze() {
  // src/index.js is owned by another agent; require lazily so this module can
  // still load (and be unit-tested) before that file exists.
  return require("./index").analyze;
}

function resolveProvider(name) {
  if (!name) return undefined;
  if (name === "mcp") return require("./binance/mcpProvider").getSnapshot ? { getSnapshot: require("./binance/mcpProvider").getSnapshot } : undefined;
  if (name === "rest") return require("./binance/restProvider");
  return undefined;
}

async function runAnalyze(flags) {
  if (!flags.symbol) {
    console.error("Usage: node src/cli.js analyze <SYMBOL> [--json] [--no-llm] [--provider rest|mcp]");
    process.exitCode = 1;
    return;
  }
  const analyze = getAnalyze();
  const provider = resolveProvider(flags.provider);
  const result = await analyze(flags.symbol, provider ? { provider } : {});

  let explanation = null;
  if (!flags.noLlm) {
    explanation = await explain(result, {
      model: process.env.GEMINI_MODEL,
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify({ result, explanation }, null, 2));
  } else {
    console.log(renderText(result, explanation));
  }
}

async function runScan(flags) {
  const analyze = getAnalyze();
  const provider = resolveProvider(flags.provider);
  const lines = [];
  let okCount = 0;
  for (const symbol of SCAN_SYMBOLS) {
    try {
      const result = await analyze(symbol, provider ? { provider } : {});
      lines.push(renderScanLine(result));
      okCount++;
    } catch (e) {
      lines.push(`${symbol}  ERROR  ${e.message}`);
    }
  }
  for (const l of lines) console.log(l);
  console.log(`--- scanned ${SCAN_SYMBOLS.length}, ${okCount} ok ---`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);
  try {
    if (cmd === "analyze") await runAnalyze(flags);
    else if (cmd === "scan") await runScan(flags);
    else {
      console.error("Usage: node src/cli.js <analyze|scan> ...");
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseFlags, main };
