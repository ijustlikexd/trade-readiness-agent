"use strict";

/**
 * **單點**穩健 z 分數與並列安全的百分位排名（「最新一筆相對視窗有多異常」）。
 * 來源：Altcoins（crypto-analyzer）app.js 的 robustZLatest / percentileRank / percentile。
 *
 * ⚠️ 先讀這段，決定你該用哪一支模組：本檔與既有的 `rolling-window-stats.js` 是**同一個概念的
 * 兩種形狀**，不是重複造輪。
 *
 *   | | `rolling-window-stats.js` | **本模組** |
 *   |---|---|---|
 *   | 輸出 | 每個點都算一次，回**整條序列** | 只算**最後一筆**，回單一數字 |
 *   | 輸入 | `{date, value}[]`，要求 bar 連續 | 純 `number[]`，只要求最後一筆最新 |
 *   | 效能 | 增量維護排序視窗，O(log n)／點 | 每次全算，適合單點呼叫 |
 *   | 取 log | `rollingRobustZ` 算 **log(value)**，**非正數會 throw** | 不取 log，**可含負值與 0** |
 *   | MAD=0 | 直接回 null | 先退回 **IQR/1.349**，都退化才回 null |
 *   | 並列值 | 百分位用 `count(<=)/n` | 用**中位排名**（見下方） |
 *
 * 選擇原則：
 *   - 要做回測、要整條特徵序列、資料是連續 bar 的月／日序列 → 用 `rolling-window-stats.js`。
 *   - 要「這個標的**現在**異常嗎」、輸入可能含負值（報酬率、OI 變化率）、
 *     或只是一次性判斷 → 用本模組。
 *
 * 需求：Node（純計算），需同層的 ./stats-basics。
 *
 * 使用範例：
 *   const { robustZLatest, percentileRank } = require("./robust-z-point");
 *   robustZLatest([10, 11, 10, 12, 40]);   // 最後一筆相對前面有多異常
 *   percentileRank([1, 2, 2, 2, 3], 2);    // 50
 */

const { median, mad } = require("./stats-basics");

/**
 * 線性內插百分位數（`p` 為 0~100）。輸入不需排序，自動濾除 null/undefined/NaN。
 *
 * 與 stats-basics 的 `quantile(values, q)` 是同一種演算法（numpy 'linear' 慣例），差別兩點：
 *   1. `p` 是 0~100，`q` 是 0~1。
 *   2. 這裡對髒資料**寬容**（濾掉後照算，全空回 null）；`quantile` 對空陣列**丟例外**。
 * 資料來自外部 API、常有 null 欄位時用這支；自己算出來的乾淨陣列用 `quantile`。
 *
 * @param {Array<number|null|undefined>} arr
 * @param {number} p 0~100
 * @returns {number|null}
 */
function percentile(arr, p) {
  const a = (arr || [])
    .filter((x) => x !== null && x !== undefined && !isNaN(x))
    .slice()
    .sort((x, y) => x - y);
  if (a.length === 0) return null;
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const frac = idx - lo;
  return a[lo] * (1 - frac) + a[hi] * frac;
}

/**
 * 最後一筆相對整個視窗的穩健 z 分數：`0.6745 × (latest − median) / dispersion`。
 *
 * `0.6745` 把 MAD 換算成與常態分布標準差可比的尺度，所以可沿用平常對 z 分數的直覺
 * （±2 明顯、±3 極端）。
 *
 * 離散度有三層，這是踩過坑才有的設計：
 *   1. 先用 MAD。
 *   2. MAD 退化為 0 → 改用 **IQR / 1.349**（1.349 同樣是對常態分布的換算係數）。
 *      MAD 退化在實務上很常見：只要視窗內超過一半的值完全相同就會發生，
 *      低流動性標的的成交量序列經常如此。既有的 `rollingRobustZ` 在這裡直接回 null，
 *      而多數這種視窗其實還有 IQR 可用——**這一層是本模組相對它的實質改進**。
 *   3. 兩者都是 0 → **回 `null`，不回 0**。
 *
 * ⚠️ 第 3 點不要改成回 0。回 0 的意思是「這一筆很正常」，但真實情況是「樣本沒有變異，
 * 無法判斷」。兩者在下游導致完全不同的決策，而回 0 會讓資訊量為零的輸入偽裝成有效訊號。
 * 原專案就是先寫成回 0，後來才改掉。
 *
 * @param {Array<number>} arr 時間序列，**最後一筆為最新**（順序錯了結果沒有意義）。可含負值。
 * @returns {number|null} 無法估計離散度時回 null
 */
function robustZLatest(arr) {
  if (!arr || arr.length === 0) return null;
  const m = median(arr);
  let d = mad(arr);
  if (!d || isNaN(d) || d === 0) {
    const q75 = percentile(arr, 75);
    const q25 = percentile(arr, 25);
    const iqr = q75 !== null && q25 !== null ? q75 - q25 : 0;
    d = iqr > 0 ? iqr / 1.349 : 0;
  }
  if (!d || isNaN(d) || d === 0) return null;
  const latest = arr[arr.length - 1];
  return (0.6745 * (latest - m)) / d;
}

/**
 * 百分位排名（**中位排名 midrank**）：`(count(x < v) + 0.5 × count(x === v)) / n × 100`。
 *
 * ⚠️ 刻意**不是** `count(x <= v) / n`。用 `<=` 會讓「等於眾數的值」被算成極高百分位。
 * 原專案的實際案例：某標的當前值恰等於自己的中位數，
 *
 *   | 公式 | 算出的百分位 |
 *   |---|---:|
 *   | `count(x <= v) / n` | **97** |
 *   | 中位排名 | **60.8** |
 *
 * 而下游的警戒門檻是 95——`<=` 版本會產生假警報。只要資料有重複值（整數、四捨五入後的
 * 百分比、低流動性標的的量價）這個差異就會實際發生，不是理論邊角。
 *
 * 註：既有的 `rolling-window-stats.js` 的 `rollingPercentile` 用的是 `count(<=)/n`。
 * 對連續的商品價格／庫存資料，完全相同的值較少見，影響小；但若拿它處理離散值或
 * 已四捨五入的序列，請留意同一個偏誤。
 *
 * @param {Array<number|null|undefined>} arr 參考分布（不需排序，自動濾除髒值）
 * @param {number} value 要定位的值
 * @returns {number|null} 0~100；value 無效或參考分布為空時回 null
 */
function percentileRank(arr, value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const a = (arr || []).filter((x) => x !== null && x !== undefined && !isNaN(x));
  if (a.length === 0) return null;
  let countLT = 0;
  let countEQ = 0;
  a.forEach((x) => {
    if (x < value) countLT++;
    else if (x === value) countEQ++;
  });
  return ((countLT + 0.5 * countEQ) / a.length) * 100;
}

module.exports = { robustZLatest, percentileRank, percentile };
