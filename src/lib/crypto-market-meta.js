"use strict";

/**
 * 市值／基本面補充資料：CoinGecko 市值快照、Binance USDⓈ-M 衍生品公開資料。
 * 來源：Altcoins（crypto-analyzer）app.js 的 fetchCoinGeckoMarketsMap /
 *       fetchBinanceTakerRatio / fetchBinanceOIHist。
 *
 * 這兩個來源的角色是**補 Bybit 沒有的東西**：
 *   - Bybit 沒有流通市值／FDV／流通量 → 找 CoinGecko
 *   - Bybit 沒有主動買賣比（taker long/short ratio）→ 找 Binance 公開端點
 * 兩者都免金鑰，但 CoinGecko 的免費層限速很嚴（見下方與 http-host-throttle 的說明）。
 *
 * 需求：Node 18+（全域 fetch），需同層的 ./http-host-throttle。
 */

const { throttledFetchJson } = require("./http-host-throttle");

/**
 * 取市值快照，回傳 `symbol（大寫） → {id, name, marketCap, fdv, circulatingSupply, totalSupply, ath, chg24h}`。
 *
 * ⚠️ **覆蓋範圍有硬上限**：預設抓 3 頁 × 250 = **前 750 名**（依市值排序）。
 * 排名之外的標的在這張表裡**完全不存在**，`marketCap` 會是 undefined。
 * 原專案實測：某個有正常交易量的標的（WAXP）因為市值排在 750 名外而查不到市值，
 * 導致所有依賴 marketCap 的計算都變成 unavailable。要提高覆蓋就加 `pages`，
 * 但每頁都是一次呼叫，要權衡限速。
 *
 * ⚠️ **symbol 會碰撞**：不同專案可能用同一個 symbol。這裡的規則是**保留市值較大者**
 * （`if (!prev || entry.marketCap > prev.marketCap)`）。實測 750 筆會收斂成約 731 個唯一 symbol，
 * 也就是有近 20 個碰撞。用 symbol 當鍵本質上不精確，但要精確就得先做 id 對映，成本高得多。
 * 如果你的標的是小市值幣，這個碰撞可能讓你拿到**另一個同名幣的市值**——這比查不到更危險。
 *
 * 節流特例：本函式對 CoinGecko host 刻意用 `minIntervalMs: 150` 覆寫預設的 8 秒。
 * 理由是這個端點結果通常會快取 1 小時、每次作業最多打 3 次；若套 8 秒間隔，快取過期時
 * 光這 3 頁就多等 16 秒。低頻端點放寬的風險遠低於逐檔呼叫 `/search`、`/coins/{id}` 那種場景。
 * 仍走 throttledFetchJson 以保留 429/5xx 的重試保護。
 *
 * @param {number} [pages=3] 抓幾頁，每頁 250 筆
 * @returns {Promise<{ok:boolean, map:Record<string,object>, pagesOk:number}>}
 *          單頁失敗不阻斷其他頁；`pagesOk` 讓呼叫端判斷覆蓋是否完整
 */
async function fetchCoinGeckoMarketsMap(pages) {
  const nPages = pages || 3;
  const map = {};
  let pagesOk = 0;
  for (let page = 1; page <= nPages; page++) {
    const r = await throttledFetchJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`,
      { minIntervalMs: 150 }
    );
    if (!r.ok || !Array.isArray(r.data)) continue; // 單頁失敗不阻斷
    pagesOk++;
    r.data.forEach((c) => {
      if (!c.symbol) return;
      const sym = String(c.symbol).toUpperCase();
      const num = (v) => (v !== null && v !== undefined ? Number(v) : null);
      const entry = {
        id: c.id,
        name: c.name || null,
        marketCap: num(c.market_cap),
        fdv: num(c.fully_diluted_valuation),
        circulatingSupply: num(c.circulating_supply),
        totalSupply: num(c.total_supply),
        ath: num(c.ath),
        chg24h: num(c.price_change_percentage_24h),
      };
      const prev = map[sym];
      if (!prev || (entry.marketCap || 0) > (prev.marketCap || 0)) map[sym] = entry;
    });
  }
  return { ok: pagesOk > 0, map, pagesOk };
}

/**
 * Binance USDⓈ-M 主動買賣比（taker long/short ratio），免金鑰。
 *
 * ⚠️ **標的在 Binance 不存在時回的是空陣列 + HTTP 200**，不是 404。
 * 所以「查不到」和「沒有資料」長得一樣，必須檢查陣列長度，不能只看 HTTP 狀態。
 * 這對只在 Bybit 上市的小幣很常見——Bybit 有的標的 Binance 未必有。
 *
 * @param {string} symbol Binance 格式（通常與 Bybit 相同，例如 "BTCUSDT"）
 * @param {"5m"|"15m"|"30m"|"1h"|"4h"|"1d"} [period="1h"]
 * @param {number} [limit=24]
 * @returns {Promise<{ok:boolean, rows?:Array<{ts:number, buySellRatio:number}>, error?:string}>} **舊到新**
 */
async function fetchBinanceTakerRatio(symbol, period, limit) {
  const r = await throttledFetchJson(
    `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${encodeURIComponent(symbol)}&period=${period || "1h"}&limit=${limit || 24}`
  );
  if (!r.ok) return { ok: false, error: r.error };
  if (!Array.isArray(r.data) || r.data.length === 0) {
    return { ok: false, error: "Binance 無此標的或無資料（空陣列 + HTTP 200）" };
  }
  return {
    ok: true,
    rows: r.data.map((x) => ({
      ts: Number(x.timestamp),
      buySellRatio: parseFloat(x.buySellRatio),
    })),
  };
}

/**
 * Binance USDⓈ-M 未平倉量歷史，免金鑰。用途通常是與 Bybit 的 OI 做跨所交叉檢查
 * （兩所 OI 變化方向不一致時，代表訊號的可信度較低）。
 *
 * 同樣有「不存在回空陣列 + 200」的行為。
 *
 * @param {string} symbol
 * @param {"5m"|"15m"|"30m"|"1h"|"4h"|"1d"} [period="1h"]
 * @param {number} [limit=24]
 * @returns {Promise<{ok:boolean, rows?:Array<{ts:number, oi:number, oiValue:number}>, error?:string}>} **舊到新**
 */
async function fetchBinanceOIHist(symbol, period, limit) {
  const r = await throttledFetchJson(
    `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${period || "1h"}&limit=${limit || 24}`
  );
  if (!r.ok) return { ok: false, error: r.error };
  if (!Array.isArray(r.data) || r.data.length === 0) {
    return { ok: false, error: "Binance 無此標的或無資料（空陣列 + HTTP 200）" };
  }
  return {
    ok: true,
    rows: r.data.map((x) => ({
      ts: Number(x.timestamp),
      oi: parseFloat(x.sumOpenInterest),
      oiValue: parseFloat(x.sumOpenInterestValue),
    })),
  };
}

module.exports = { fetchCoinGeckoMarketsMap, fetchBinanceTakerRatio, fetchBinanceOIHist };
