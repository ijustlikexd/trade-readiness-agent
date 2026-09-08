"use strict";
// LLM explanation layer. The engine decides; this only narrates. Never trust the
// LLM to change `decision` — guarded below. docs/SPEC.md §9.

const SYSTEM_RULE =
  "You are explaining a deterministic analysis. Never change numbers or the decision. " +
  "Output <= 120 words: 1 sentence regime, 2-3 bullet reasons, 1 sentence risk.";

function maskKey(str, apiKey) {
  if (!apiKey) return str;
  return String(str).split(apiKey).join("***");
}

// Strip large/irrelevant arrays (swings) before sending to the LLM.
function compactResult(result) {
  const clone = JSON.parse(JSON.stringify(result || {}));
  if (clone.structure) {
    delete clone.structure.swings4h;
    delete clone.structure.swings1h;
  }
  return clone;
}

function templateFallback(result) {
  const plan = result.plan || {};
  const conf = result.confluence || {};
  const gate = result.gate || {};
  const regime = result.regime || "Unclear regime";
  const bullets = [];
  bullets.push(`- Direction ${plan.direction || "NONE"}, confluence ${conf.score == null ? "n/a" : Math.round(conf.score)}/100`);
  if (plan.rr != null) bullets.push(`- Risk/reward ${plan.rr.toFixed(2)} vs entry ${plan.entry}`);
  const reasons = (gate.hardReasons || []).concat(gate.watchReasons || []);
  if (reasons.length) bullets.push(`- ${reasons[0]}`);
  const risk = reasons.length ? reasons[reasons.length - 1] : "Standard market risk applies.";
  return `${regime}.\n${bullets.join("\n")}\nRisk: ${risk}`;
}

function buildPrompt(result) {
  const compact = compactResult(result);
  return `${SYSTEM_RULE}\n\nResult JSON:\n${JSON.stringify(compact)}`;
}

async function callGemini({ model, apiKey, prompt, timeoutMs }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2, maxOutputTokens: 400 },
  };

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const status = res.status;
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* ignore parse failure, handled below */
    }
    if (!res.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : `HTTP ${status}`;
      const err = new Error(maskKey(msg, apiKey));
      err.status = status;
      throw err;
    }
    const cands = (json && json.candidates) || [];
    const parts = (cands[0] && cands[0].content && cands[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    if (!text) throw new Error("Empty Gemini response");
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// If LLM text mentions a different decision word than result.decision, append a
// correction line so the deterministic decision always wins visibly.
function guardDecision(text, result) {
  const words = ["TRADE READY", "WATCH", "NO TRADE"];
  const decision = result.decision;
  const upper = text.toUpperCase();
  const mentioned = words.filter((w) => upper.includes(w));
  const contradicts = mentioned.some((w) => w !== decision);
  if (contradicts) {
    return `${text}\n(Engine decision stands: ${decision})`;
  }
  return text;
}

async function explain(result, opts = {}) {
  const { model, apiKey, timeoutMs = 20000 } = opts;
  if (!apiKey || !model) {
    return { text: templateFallback(result), source: "template" };
  }

  const prompt = buildPrompt(result);
  let lastErr = null;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const text = await callGemini({ model, apiKey, prompt, timeoutMs });
      return { text: guardDecision(text, result), source: "gemini" };
    } catch (e) {
      lastErr = e;
      const retryable = e.status === undefined || e.status >= 500 || e.status === 429;
      if (!retryable || attempt >= 1) break;
    }
  }
  const msg = lastErr ? maskKey(lastErr.message, apiKey) : "unknown error";
  return { text: templateFallback(result), source: "template", error: msg };
}

module.exports = { explain, templateFallback, guardDecision, buildPrompt, maskKey };
