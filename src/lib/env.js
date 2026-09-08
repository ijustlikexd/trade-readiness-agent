"use strict";
/**
 * Tiny .env loader. KEY=VALUE lines, ignores blank lines and lines starting with #.
 * Never overrides a key already present in process.env.
 */
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const p = file || path.join(process.cwd(), ".env");
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (e) {
    return; // no .env file, nothing to do
  }
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  });
}

module.exports = { loadEnv };
