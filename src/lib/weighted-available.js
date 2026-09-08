"use strict";

/**
 * 缺項重正規化加權平均：把「這項沒資料」和「這項得 0 分」嚴格分開處理。
 * 來源：Altcoins（crypto-analyzer）app.js 的 weightedAvailable / clamp。
 *
 * 這是本庫裡最不像演算法、但踩坑代價最高的一個模組。任何「用多個子項加權算出一個總分」的
 * 評分系統都會遇到同一個問題：**某些子項的資料源掛了或本來就取不到**。有三種做法：
 *
 *   (a) 缺項當 0 分       → 資料源掛掉的標的一律被打成低分。用「沒查到壞事」當成「有壞事」。
 *   (b) 缺項當中間值 50   → 憑空製造一個沒有依據的數字，而且無法從結果分辨哪些是猜的。
 *   (c) 缺項踢出分母       → 只用**實際可得**的權重重新正規化。← 本模組
 *
 * (c) 是唯一不說謊的做法，但它有一個必須一起處理的副作用，見下方 `score` 與 `availWeight`
 * 的說明——這個副作用原專案是事後才發現的。
 *
 * 需求：Node（純計算），無相依。
 *
 * 使用範例：
 *   const { weightedAvailable, clamp } = require("./weighted-available");
 *
 *   weightedAvailable([
 *     { val: 80,   weight: 0.5 },
 *     { val: null,  weight: 0.3 },   // 資料源掛了
 *     { val: 60,   weight: 0.2 },
 *   ]);
 *   // → { score: 74.28…, availWeight: 0.7, totalWeight: 1 }
 *   //   80×(0.5/0.7) + 60×(0.2/0.7)，缺的 0.3 完全不參與，不當 0 也不當 50
 */

/**
 * 夾在區間內。
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 依「可用權重」重新正規化的加權平均。
 *
 * 回傳三個值，而且**三個都要用**：
 *   - `score`：只用可得子項算出的分數（0~100）。全部缺 → `null`（不是 0）。
 *   - `availWeight`：可得子項的權重總和。這是**信賴度**，不是附註。
 *   - `totalWeight`：全部子項的權重總和（通常是 1 或 100，看你怎麼定義）。
 *
 * ⚠️ 最重要的一件事：`score` 是「在可得資料範圍內的表現」，不是「整體表現」。
 * 只有 40% 權重可得時算出 99 分，意思是「在我看得到的那 40% 裡近乎滿分」，**不代表整體優秀**。
 * 原專案實際發生過：某標的只有 40% 覆蓋率卻拿到 99 分並排到榜首。
 *
 * 兩種正確的用法，看你的下游需要什麼：
 *   1. 要「可比的排序分數」→ 用 `score × availWeight`（低覆蓋率自動被壓下去）。
 *   2. 要「條件式判斷」→ 用 `score`，但**同時**檢查 `availWeight` 是否達到你的最低門檻，
 *      不到門檻就當 unavailable，不要拿去比較。
 * 直接把不同 `availWeight` 的 `score` 混在一起排序，是這個模組唯一的誤用方式。
 *
 * @param {Array<{val:number|null|undefined, weight:number}>} parts
 * @returns {{score:number|null, availWeight:number, totalWeight:number}}
 */
function weightedAvailable(parts) {
  const avail = parts.filter((p) => p.val !== null && p.val !== undefined && !isNaN(p.val));
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  if (avail.length === 0) return { score: null, availWeight: 0, totalWeight };
  const availWeight = avail.reduce((a, p) => a + p.weight, 0);
  const score = avail.reduce((a, p) => a + p.val * (p.weight / availWeight), 0);
  return { score: clamp(score, 0, 100), availWeight, totalWeight };
}

/**
 * 三值邏輯的 AND：`true`／`false`／`null`（資料不可得）。
 *
 * 為什麼需要這個而不是直接寫 `a && b && c`：JS 會把 `null` 當 falsy，所以
 * `null && true` 得到 `null`（勉強可用），但 `null >= 0.005` 會得到 **`false`**
 * ——資料不可得被靜默偽裝成「條件確定不成立」。在風險判斷上這是錯的方向：
 * 「沒查到危險」被當成「確認安全」。
 *
 * 原專案的規則是：任一腿為 `null` 時，整個判斷必須是 `null`（unavailable），
 * 而且要能講出**哪一腿缺、為什麼缺**，不能只回一個 false。
 *
 * @param {Array<boolean|null|undefined>} legs
 * @returns {boolean|null} 有任一腿不可得回 null；全部可得才回 true/false
 */
function andStrict(legs) {
  if (legs.some((v) => v === null || v === undefined)) return null;
  return legs.every((v) => v === true);
}

module.exports = { weightedAvailable, clamp, andStrict };
