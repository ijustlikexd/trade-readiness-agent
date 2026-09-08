"use strict";

/**
 * 從 LLM 回傳的「髒」文字裡穩健地取出 JSON。
 * 來源:聚餐分帳計算器(PriceCalculator,C#/WPF)`ImportParser.cs`,泛化成通用工具。
 *
 * 為什麼需要:就算 prompt 明寫「只輸出 JSON、不要 markdown」,模型還是常常會:
 *   - 包上 ```json … ``` 圍欄;
 *   - 前後多一兩句寒暄(「以下是結果:」「希望有幫助!」);
 *   - 把數字寫成字串,還帶千分位逗號或貨幣符號("1,280"、"NT$100"、"10%");
 * 直接 `JSON.parse` 會炸。這支模組把這些狀況一次吃掉:去圍欄 → 擷取第一個
 * `{`/`[` 到最後一個 `}`/`]` 之間 → `JSON.parse`。
 *
 * 設計成**與領域無關**:核心 `extractJson`/`extractArray` 不管欄位長什麼樣;
 * `toNumber` 只負責把「像數字的字串」轉成數字。要對映欄位名(name/amount/…)
 * 由呼叫端自己做,才不會綁死在某種收據格式。
 *
 * 相依:無(純 JS)。
 *
 * 使用範例:
 *   const { extractJson, extractArray, toNumber } = require("./llm-json-extract");
 *   const obj   = extractJson(llmText);                    // 回 parsed(物件或陣列)
 *   const items = extractArray(llmText, { key: "items" }); // 回陣列
 *   const price = toNumber("NT$1,280");                    // 1280
 */

/**
 * 從髒文字取出並 parse 第一個 JSON 值。
 * @param {string} raw LLM 原始輸出
 * @returns {any} JSON.parse 後的物件/陣列
 * @throws 找不到 JSON 或 parse 失敗時 throw
 */
function extractJson(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error("內容是空的");

  // 去掉 markdown code fence(```json … ```)
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n");
    if (nl >= 0) s = s.slice(nl + 1);
    const fence = s.lastIndexOf("```");
    if (fence >= 0) s = s.slice(0, fence);
    s = s.trim();
  }

  // 擷取第一個 { 或 [ 到最後一個 } 或 ](去掉前後贅字)
  const starts = [s.indexOf("{"), s.indexOf("[")].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start < 0 || end <= start) throw new Error("找不到 JSON 內容");
  s = s.slice(start, end + 1);

  return JSON.parse(s);
}

/**
 * 從髒文字取出「一個陣列」:root 是陣列就回它;root 是物件且 `key` 欄位是陣列就回那個。
 * @param {string} raw
 * @param {object} [opts]
 * @param {string} [opts.key="items"] 物件包陣列時的欄位名
 * @returns {any[]}
 */
function extractArray(raw, opts = {}) {
  const key = opts.key || "items";
  const root = extractJson(raw);
  if (Array.isArray(root)) return root;
  if (root && typeof root === "object" && Array.isArray(root[key])) return root[key];
  throw new Error(`JSON 需為陣列或 {"${key}":[...]} 格式`);
}

/**
 * 把「像數字的值」轉成數字:接受 number 直接回;字串則去掉千分位逗號(半形/全形)、
 * 常見貨幣符號與 %、空白再 parse。無法解析回 `fallback`(預設 0)。
 * @param {*} v
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toNumber(v, fallback = 0) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return fallback;
  const cleaned = v.replace(/[,，]/g, "").replace(/NT\$|＄|\$|％|%|\s/gi, "").trim();
  if (cleaned === "") return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 小工具:從物件依「多個候選欄位名」取第一個存在的字串/數字(容忍模型換 key)。
 * @example pick(item, ["name","品名","品項"])
 */
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

module.exports = { extractJson, extractArray, toNumber, pick };
