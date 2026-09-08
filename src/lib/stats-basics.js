"use strict";

/**
 * 基礎統計函式：平均、中位數、樣本標準差、分位數（線性插值）、MAD。
 * 來源：Cyclical commodities packages/core/src/stats-utils.ts。
 *
 * 這些是後面所有滾動視窗／事件偵測／自舉信賴區間模組共用的最底層積木，
 * 刻意保持純函式、零相依，方便單獨測試與重用。
 *
 * 使用範例：
 *   const { mean, median, stdev, quantile, mad } = require("./stats-basics");
 *   mean([1, 2, 3]);        // 2
 *   quantile([1, 2, 3, 4], 0.25); // 1.75（numpy 預設 'linear' 慣例）
 */

/**
 * 算術平均。
 * @param {number[]} values 非空陣列
 * @returns {number}
 * @throws 陣列為空時 throw
 */
function mean(values) {
  if (values.length === 0) throw new Error("mean: 輸入陣列為空");
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * 中位數。偶數長度時取中間兩數的平均。
 * @param {number[]} values 非空陣列
 * @returns {number}
 * @throws 陣列為空時 throw
 */
function median(values) {
  if (values.length === 0) throw new Error("median: 輸入陣列為空");
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * 樣本標準差（分母 n-1，非母體標準差）。
 * 長度 <= 1 時回 0（此時「離散程度」沒有意義，回 0 比丟例外更方便呼叫端串接）。
 * @param {number[]} values
 * @returns {number}
 */
function stdev(values) {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * 線性插值分位數／百分位數，`q` 為 [0,1] 之間的小數。
 *
 * 注意：分位數的定義有好幾種業界慣例（R 有 9 種、Excel 又不同），這裡採用
 * numpy／pandas **預設**（'linear'）的算法：位置 = q*(n-1)，落在兩個整數之間
 * 時取線性插值。跟別的系統（例如某些 BI 工具用的 nearest-rank）對答案時，
 * 如果數字對不上，先檢查對方用的是哪一種分位數定義，不要急著懷疑程式碼錯。
 *
 * @param {number[]} values 非空陣列
 * @param {number} q 0 到 1 之間
 * @returns {number}
 * @throws 陣列為空或 q 超出 [0,1] 時 throw
 */
function quantile(values, q) {
  if (values.length === 0) throw new Error("quantile: 輸入陣列為空");
  if (q < 0 || q > 1) throw new Error(`quantile: q 必須在 [0,1] 之間，收到 ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const pos = q * (n - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const frac = pos - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/**
 * MAD（Median Absolute Deviation，中位數絕對偏差）：median(|xi - median(x)|)。
 * 比標準差更抗極端值——這正是後面 robust-z 選用 MAD 而不是 σ 的原因
 * （見 rolling-window-stats 模組）。
 * @param {number[]} values 非空陣列
 * @returns {number}
 */
function mad(values) {
  const med = median(values);
  const absDevs = values.map((v) => Math.abs(v - med));
  return median(absDevs);
}

module.exports = { mean, median, stdev, quantile, mad };
