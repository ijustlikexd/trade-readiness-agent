"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { explain, templateFallback, guardDecision } = require("../src/agent/explain");

function buildResult(decision) {
  return {
    symbol: "SOLUSDT",
    regime: "Bullish Pullback",
    decision: decision || "WATCH",
    plan: { direction: "LONG", entry: 119.1, rr: 2.31 },
    confluence: { score: 82 },
    gate: { hardReasons: [], watchReasons: ["Waiting for confirmation near support."] },
  };
}

test("template fallback works without network (no apiKey/model)", async () => {
  const result = buildResult();
  const out = await explain(result, {});
  assert.equal(out.source, "template");
  assert.match(out.text, /Bullish Pullback/);
  assert.equal(out.error, undefined);
});

test("templateFallback is deterministic from result", () => {
  const result = buildResult();
  const a = templateFallback(result);
  const b = templateFallback(result);
  assert.equal(a, b);
  assert.match(a, /LONG/);
});

test("guardDecision leaves matching decision text untouched", () => {
  const result = buildResult("WATCH");
  const text = "Bullish pullback. Decision: WATCH. Risk: funding elevated.";
  const out = guardDecision(text, result);
  assert.equal(out, text);
});

test("guardDecision appends correction when LLM contradicts engine decision", () => {
  const result = buildResult("NO TRADE");
  const text = "Looks strong, recommend TRADE READY here.";
  const out = guardDecision(text, result);
  assert.match(out, /Engine decision stands: NO TRADE/);
});

test("explain masks api key in returned error message on failure", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: "secret-key-1234 rejected" } }),
  });
  try {
    const result = buildResult();
    const out = await explain(result, { model: "gemini-flash-latest", apiKey: "secret-key-1234", timeoutMs: 1000 });
    assert.equal(out.source, "template");
    assert.ok(!out.error.includes("secret-key-1234"));
  } finally {
    global.fetch = originalFetch;
  }
});
