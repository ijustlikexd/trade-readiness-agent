"use strict";
// TRADE PASSPORT text renderer. Pure formatting — never recomputes numbers.
// Result shape: docs/SPEC.md §8.

const WIDTH = 40;
const RULE = "-".repeat(WIDTH);

function decimalsFor(result) {
  const d = result && result.raw && result.raw.decimals;
  return Number.isFinite(d) ? d : 2;
}

function fmt(n, dec) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return Number(n).toFixed(dec);
}

function statusMark(status) {
  if (status === "ok") return "✓"; // ✓
  if (status === "warn") return "⚠"; // ⚠
  if (status === "bad") return "✗"; // ✗
  return "-"; // na
}

const FACTOR_LABELS = {
  htf: "HTF structure",
  snr: "Support/Resistance",
  vegas: "Vegas channel",
  volume: "Volume",
  oi: "Open interest",
  funding: "Funding",
  liquidity: "Liquidity",
  rr: "Risk/Reward",
};

function renderText(result, explanation) {
  const dec = decimalsFor(result);
  const lines = [];
  lines.push(RULE);
  lines.push(`${result.symbol} TRADE PASSPORT`);
  lines.push(RULE);
  lines.push("");

  lines.push("Market Regime:");
  lines.push(result.regime || "n/a");
  lines.push("");

  const t4 = result.trend && result.trend["4h"];
  const t1 = result.trend && result.trend["1h"];
  lines.push("4H:");
  lines.push(t4 ? cap(t4.label || t4.trend || t4) : "n/a");
  lines.push("");
  lines.push("1H:");
  lines.push(t1 ? cap(t1.label || t1.trend || t1) : "n/a");
  lines.push("");

  const snr = result.snr || {};
  if (snr.support) {
    lines.push("Support:");
    lines.push(`${fmt(snr.support.zoneLow, dec)} - ${fmt(snr.support.zoneHigh, dec)}`);
    lines.push("");
  }
  if (snr.resistance) {
    lines.push("Resistance:");
    lines.push(`${fmt(snr.resistance.zoneLow, dec)} - ${fmt(snr.resistance.zoneHigh, dec)}`);
    lines.push("");
  }

  const plan = result.plan || {};
  lines.push("Entry:");
  if (plan.entryZone && plan.entryZone.length === 2) {
    lines.push(`${fmt(plan.entryZone[0], dec)} - ${fmt(plan.entryZone[1], dec)}`);
  } else {
    lines.push(fmt(plan.entry, dec));
  }
  lines.push("");

  lines.push("Invalidation:");
  lines.push(fmt(plan.invalidation, dec));
  lines.push("");

  lines.push("Target:");
  if (plan.target1 == null) {
    lines.push("n/a");
  } else if (plan.target2 == null) {
    lines.push(fmt(plan.target1, dec));
  } else {
    lines.push(`${fmt(plan.target1, dec)} / ${fmt(plan.target2, dec)}`);
  }
  lines.push("");

  lines.push("R:R:");
  lines.push(plan.rr == null ? "n/a" : fmt(plan.rr, 2));
  lines.push("");

  const conf = result.confluence || {};
  const covPct = Number.isFinite(conf.availWeight) ? Math.round(conf.availWeight * 100) : null;
  lines.push("Confluence:");
  lines.push(
    `${conf.score == null ? "n/a" : Math.round(conf.score)} / 100` +
      (covPct != null ? ` (coverage ${covPct}%)` : "")
  );
  lines.push("");

  const factors = conf.factors || {};
  lines.push("Factors:");
  for (const key of Object.keys(FACTOR_LABELS)) {
    const f = factors[key];
    if (!f) continue;
    const mark = statusMark(f.status);
    const val = f.val == null ? "n/a" : Math.round(f.val);
    const note = f.note ? ` - ${f.note}` : "";
    lines.push(`${mark} ${FACTOR_LABELS[key]} (${val})${note}`);
  }
  lines.push("");

  lines.push("Decision:");
  lines.push(result.decision || "n/a");
  lines.push("");

  const gate = result.gate || {};
  if ((gate.hardReasons && gate.hardReasons.length) || (gate.watchReasons && gate.watchReasons.length)) {
    lines.push("Gate Reasons:");
    for (const r of gate.hardReasons || []) lines.push(`- ${r}`);
    for (const r of gate.watchReasons || []) lines.push(`- ${r}`);
    lines.push("");
  }

  if (explanation && explanation.text) {
    lines.push("Explanation:");
    lines.push(explanation.text);
    lines.push("");
  }

  lines.push(`Source: ${result.source || "n/a"}  |  Generated: ${result.generatedAt || "n/a"}`);
  lines.push(RULE);

  return lines.join("\n");
}

function cap(s) {
  if (!s || typeof s !== "string") return "n/a";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderScanLine(result) {
  const dec = decimalsFor(result);
  const plan = result.plan || {};
  const conf = result.confluence || {};
  const rr = plan.rr == null ? "n/a" : fmt(plan.rr, 2);
  const entry =
    plan.entryZone && plan.entryZone.length === 2
      ? `${fmt(plan.entryZone[0], dec)}-${fmt(plan.entryZone[1], dec)}`
      : fmt(plan.entry, dec);
  const direction = plan.direction || "NONE";
  const conf100 = conf.score == null ? "n/a" : Math.round(conf.score);
  return `${result.symbol}  ${direction}  ${result.decision || "n/a"}  conf ${conf100}  rr ${rr}  entry ${entry}`;
}

module.exports = { renderText, renderScanLine };
