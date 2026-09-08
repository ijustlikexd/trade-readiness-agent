"use strict";

/**
 * K 線技術指標：EMA、Wilder ATR、成交額穩健 Z、tickSize 小數位推算。
 * 來源：Altcoins（crypto-analyzer）app.js 的 ema / computeATR / computeVolumeRobustZ /
 *       computeOIRobustZ / decimalsFromTick。
 *
 * ⚠️ 全模組共同前提：K 線陣列一律是**由舊到新**（最後一筆最新）。
 * 交易所 API 回來的常是反過來的（Bybit 的 kline 與 open-interest 都是新到舊），
 * 忘記 reverse 不會報錯，只會安靜地算出反向的結果。見 info/crypto-exchange-apis.md。
 *
 * 需求：Node（純計算），需同層的 ./robust-z-point（及其相依 ./stats-basics）。
 *
 * 使用範例：
 *   const { ema, computeATR, computeVolumeRobustZ } = require("./kline-indicators");
 *   const closes = kl.map((k) => k.close);        // kl 為舊→新
 *   const ema50 = ema(closes, 50);                // 同長度陣列，前 period-1 筆為 null
 *   const { atr } = computeATR(kl, 14);
 */

const { robustZLatest } = require("./robust-z-point");

/**
 * 指數移動平均。回傳與輸入同長度的陣列，前 `period-1` 筆為 `null`（尚無足夠資料）。
 * 起始值（seed）採前 `period` 筆的**簡單平均**。
 *
 * ⚠️ EMA 是路徑相依的：**同一個 period、同一段最新資料，餵不同長度的歷史會算出不同的值。**
 * 因為 seed 的殘餘影響會隨更新次數衰減 `(1-k)^n`。以 period=50 為例（k = 2/51 ≈ 0.0392）：
 *
 *   | 輸入長度 | seed 之後的更新次數 | seed 對最後一筆的殘餘權重 |
 *   |---|---:|---:|
 *   | 100 根 | 50  | ≈ 13.8% |
 *   | 168 根 | 118 | ≈  0.94% |
 *
 * 實務上的意義：如果你為了新增一個「7 日區間位置」之類的指標而把 K 線抓取長度從 100 加到 168，
 * **原本所有吃同一個陣列的 EMA 指標數值都會跟著變**，不是只多一個指標而已。
 * 原專案的處理方式是「抓 168 根算新指標，但切尾端 100 根餵給既有指標」，
 * 讓既有數值逐字不變；同時也保證冷抓與讀快取兩條路徑算出來相同。
 * 這比「順手加長就好」重要得多——後者會讓一次新增功能悄悄改動所有既有分數。
 *
 * @param {number[]} values 由舊到新
 * @param {number} period
 * @returns {Array<number|null>} 同長度；前 period-1 筆為 null
 */
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * ATR（Wilder 平滑）。起始 ATR 為前 `period` 筆 TR 的簡單平均，之後用
 * `atr = (atr×(period−1) + tr) / period` 遞推。
 *
 * 與 `ema` 同樣是路徑相依，上面那段警告一樣適用。
 *
 * TR 需要前一根收盤，所以資料至少要 `period + 1` 根，不足時回 `{atr: null}`——
 * 回 null 而不是回一個用不足資料硬算的數字。
 *
 * @param {Array<{high:number, low:number, close:number}>} kl 由舊到新
 * @param {number} period 常用 14
 * @returns {{atr:number|null, trSeries:number[]}}
 */
function computeATR(kl, period) {
  if (kl.length < period + 1) return { atr: null, trSeries: [] };
  const trSeries = [];
  for (let i = 1; i < kl.length; i++) {
    const h = kl[i].high;
    const l = kl[i].low;
    const pc = kl[i - 1].close;
    trSeries.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trSeries.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trSeries.length; i++) {
    atr = (atr * (period - 1) + trSeries[i]) / period;
  }
  return { atr, trSeries };
}

/**
 * 最近 20 根的成交額穩健 Z 分數（用 turnover 而非 volume）。
 *
 * 為什麼用 turnover（成交額，計價幣單位）不用 volume（成交量，幣本位）：
 * volume 會被幣價變動污染——價格腰斬時同樣的資金流會產生兩倍的 volume。
 * turnover 直接就是資金流規模，跨時間、跨標的都可比。
 *
 * @param {Array<{turnover:number}>} kline 由舊到新，需 ≥ 20 根
 * @returns {number|null} 不足 20 根或離散度退化時回 null
 */
function computeVolumeRobustZ(kline) {
  if (!kline || kline.length < 20) return null;
  const turnovers = kline.map((k) => k.turnover).slice(-20);
  return robustZLatest(turnovers);
}

/**
 * 未平倉量（OI）穩健 Z 分數。
 *
 * 這支存在的唯一理由就是**順序轉換**：Bybit 的 open-interest 端點回傳**新到舊**，
 * 而 `robustZLatest` 取陣列最後一筆當最新。直接餵進去會算成「最舊那筆有多異常」。
 * 把這個轉換固定在函式裡，比每個呼叫端各自記得 reverse 可靠。
 *
 * @param {Array<{oi:number}>} oiHistNewestFirst **新到舊**（即 Bybit 原始順序），需 ≥ 10 筆
 * @returns {number|null}
 */
function computeOIRobustZ(oiHistNewestFirst) {
  if (!oiHistNewestFirst || oiHistNewestFirst.length < 10) return null;
  const chron = oiHistNewestFirst
    .slice()
    .reverse()
    .map((r) => r.oi);
  return robustZLatest(chron);
}

/**
 * 從 tickSize 字串推算價格該顯示幾位小數。
 *
 * 為什麼要從 tickSize 推而不是固定位數：山寨幣的價格尺度差好幾個數量級
 * （`0.01` 到 `0.00000001` 都有）。固定 4 位會把迷因幣顯示成 `0.0000`。
 * tickSize 來自交易所的 instruments-info，是該商品的最小跳動單位，正好就是需要的精度。
 *
 * @param {string|number} tickSize 例如 "0.0001"、"0.5"
 * @returns {number} 小數位數；`tickSize` 缺失時回預設 4
 */
function decimalsFromTick(tickSize) {
  if (!tickSize) return 4;
  const s = String(tickSize);
  if (s.indexOf(".") === -1) return 0;
  return s.split(".")[1].replace(/0+$/, "").length || s.split(".")[1].length;
}

module.exports = { ema, computeATR, computeVolumeRobustZ, computeOIRobustZ, decimalsFromTick };
