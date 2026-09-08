"use strict";

/**
 * 無頭 Chrome 截圖：極簡 DevTools Protocol 客戶端＋啟動無頭 Chrome＋
 * 「等頁面自報就緒才截圖」的擷取流程。零依賴（Node 22+ 內建 WebSocket、
 * fetch）。
 * 來源：Perspective（透視訓練工具）tools/capture-shots.mjs（行銷截圖管線）。
 *
 * 通用用途：任何要對「真實非同步」的網頁（fetch、圖片解碼、worker 解析、
 * WebGL/Three.js 場景初始化……）批量截圖的場景——`chrome --screenshot` 這種
 * 盲拍模式只有「時間預算」可控，等不到條件成立，對真實非同步一定會拍到
 * 半成品。這裡的做法是：頁面自己在 setup 完成時設一個就緒旗標，外部用
 * CDP 輪詢這個旗標，亮了才截圖。踩過的坑與原理見同名 info 文件
 * `headless-chrome-screenshot.md`，這裡只是把可重用的三塊機制抽出來。
 *
 * 使用範例（批次截圖，單一 Chrome 實例共用著色器快取）：
 *   const { launchChrome, captureWhenReady, detectChromePath } = require("./cdp-headless-shots");
 *
 *   const chromePath = detectChromePath();
 *   const chrome = await launchChrome({ chromePath, debugPort: 9377 });
 *   try {
 *     for (const job of jobs) {
 *       const r = await captureWhenReady({
 *         debugPort: 9377,
 *         url: job.url,
 *         outPath: job.outPath,
 *         size: { width: 1600, height: 1000 },
 *         readyExpression: "document.body ? (document.body.dataset.shotReady ?? null) : null",
 *       });
 *       console.log(job.outPath, r.ok ? `OK（${r.readyMs}ms）` : `FAIL: ${r.error}`);
 *     }
 *   } finally {
 *     await chrome.close();
 *   }
 */

const { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 極簡 CDP 客戶端：一條 WebSocket、遞增 id、Promise 對應回覆。事件用 once 等待。 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = [];
    ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.eventWaiters = this.eventWaiters.filter((w) => {
          if (w.method === msg.method) { w.resolve(msg.params); return false; }
          return true;
        });
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error(`WS 連線失敗：${url}`)));
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((resolve) => this.eventWaiters.push({ method, resolve }));
  }
  close() {
    try { this.ws.close(); } catch { /* 忽略 */ }
  }
}

async function httpJson(url, method = "GET") {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * 偵測本機 Chrome 執行檔路徑（Windows 常見安裝位置）。
 * @param {string} [override] 指定路徑優先使用（存在才採用，否則繼續往下找）
 * @returns {string|null} 找不到回傳 null
 */
function detectChromePath(override) {
  const candidates = [
    override,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * 啟動單一無頭 Chrome（`--headless=new` ＋ remote debugging ＋暫存
 * user-data-dir），輪詢 `/json/version` 直到就緒。
 *
 * 故意只啟動**一個**實例讓多次截圖共用：同一份瀏覽器行程會共享著色器
 * 編譯快取，對 WebGL/Three.js 場景在意義重大（見 info 文件）。
 * @param {object} options
 * @param {string} options.chromePath Chrome 執行檔完整路徑
 * @param {number} options.debugPort remote debugging 埠號
 * @param {string[]} [options.extraArgs] 額外命令列參數，附加在預設參數之後
 * @param {number} [options.readyTimeoutMs=15000] 等待 remote debugging 端點就緒的逾時
 * @returns {Promise<{proc: import('node:child_process').ChildProcess, userDataDir: string, close: () => Promise<void>}>}
 */
async function launchChrome({ chromePath, debugPort, extraArgs = [], readyTimeoutMs = 15000 }) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "cdp-shots-"));
  const proc = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--no-first-run",
    "--metrics-recording-only",
    ...extraArgs,
    "about:blank",
  ], { stdio: "ignore" });

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await httpJson(`http://127.0.0.1:${debugPort}/json/version`);
      return {
        proc,
        userDataDir,
        async close() {
          proc.kill();
          await sleep(400);
          try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
        },
      };
    } catch {
      await sleep(250);
    }
  }
  proc.kill();
  throw new Error(`[cdp-headless-shots] Chrome remote debugging 端點 ${readyTimeoutMs}ms 內沒起來`);
}

/**
 * 開新分頁 → 設視窗尺寸 → 導航 → 輪詢就緒旗標 → 截圖存檔 → 關分頁。
 * 不 throw：任何失敗都回傳 `{ok:false, error}`，方便批次執行時逐項收集結果。
 *
 * @param {object} options
 * @param {number} options.debugPort launchChrome() 用的同一個 remote debugging 埠號
 * @param {string} options.url 要截圖的網址
 * @param {string} options.outPath 輸出 PNG 檔案路徑（會自動建立目錄）
 * @param {{width:number,height:number}} options.size 視窗尺寸
 * @param {string} options.readyExpression
 *   在頁面 context 執行的 JS 表達式（字串），輪詢直到回傳字串 `'true'`
 *   （視為就緒，開始截圖）或 `'error'`（頁面自報失敗，中止並回錯誤）；
 *   其他回傳值（包含 `null`/`undefined`）視為「還沒準備好」，繼續等待。
 *   典型寫法是頁面自己維護一個 DOM dataset 旗標：
 *   `"document.body ? (document.body.dataset.shotReady ?? null) : null"`。
 * @param {number} [options.timeoutMs=60000] 等待就緒旗標的總逾時（真實毫秒）
 * @param {number} [options.pollMs=250] 輪詢間隔
 * @param {number} [options.settleMs=700] 旗標亮起後再等待這麼久才截圖（讓最後一幀渲染/字型穩定）
 * @returns {Promise<{ok:boolean, error?:string, readyMs?:number}>}
 */
async function captureWhenReady({ debugPort, url, outPath, size, readyExpression, timeoutMs = 60000, pollMs = 250, settleMs = 700 }) {
  let tab;
  let cdp;
  const t0 = Date.now();
  try {
    tab = await httpJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, "PUT");
    cdp = await Cdp.connect(tab.webSocketDebuggerUrl);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });

    let ready = null;
    while (Date.now() - t0 < timeoutMs) {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: readyExpression,
        returnByValue: true,
      });
      ready = result.value;
      if (ready === "true" || ready === "error") break;
      await sleep(pollMs);
    }
    if (ready === "error") return { ok: false, error: "頁面自報 error（readyExpression 回傳 'error'）" };
    if (ready !== "true") return { ok: false, error: `等待就緒逾時（${timeoutMs}ms）` };

    await sleep(settleMs);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(shot.data, "base64"));
    return { ok: true, readyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (cdp) cdp.close();
    if (tab) {
      try { await httpJson(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`); } catch { /* 忽略 */ }
    }
  }
}

module.exports = { Cdp, detectChromePath, launchChrome, captureWhenReady };
