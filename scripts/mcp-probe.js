#!/usr/bin/env node
"use strict";
// Prints Binance Agent OS MCP tool names/descriptions, or a clear message if
// BINANCE_MCP_TOKEN is missing / the endpoint rejects it. docs/SPEC.md §10.

const { loadEnv } = require("../src/lib/env");
loadEnv();

const { probe } = require("../src/binance/mcpProvider");

async function main() {
  if (!process.env.BINANCE_MCP_TOKEN) {
    console.log("BINANCE_MCP_TOKEN is not set — cannot probe Binance MCP. Set it in .env.");
    process.exit(0);
  }
  try {
    const tools = await probe();
    if (!tools.length) {
      console.log("MCP responded but listed no tools.");
      return;
    }
    console.log(`Binance MCP tools (${tools.length}):`);
    for (const t of tools) {
      console.log(`- ${t.name}: ${t.description || "(no description)"}`);
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      console.log(`MCP auth rejected (HTTP ${e.status}). Check BINANCE_MCP_TOKEN.`);
    } else {
      console.log(`MCP probe failed: ${e.message}`);
    }
    process.exitCode = 1;
  }
}

main();
