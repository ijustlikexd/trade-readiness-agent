// One-off: render docs/demo pages to PNG via headless Chrome (for README).
const path = require("path");
const { pathToFileURL } = require("url");
const { detectChromePath, launchChrome, captureWhenReady } = require("./_cdp");

const READY = "document.readyState === 'complete' ? 'true' : null";

(async () => {
  const chrome = await launchChrome({ chromePath: detectChromePath(), debugPort: 9377 });
  try {
    const shots = [
      { file: "docs/demo/passport.html", out: "docs/screenshot-passport.png", size: { width: 960, height: 1500 }, settleMs: 800 },
      { file: "docs/demo/demo.html", hash: "#scene=3", out: "docs/screenshot-demo.png", size: { width: 1280, height: 720 }, settleMs: 1500 },
    ];
    for (const s of shots) {
      const url = pathToFileURL(path.resolve(s.file)).href + (s.hash || "");
      const r = await captureWhenReady({ debugPort: 9377, url, outPath: s.out, size: s.size, readyExpression: READY, settleMs: s.settleMs });
      console.log(s.out, r.ok ? "ok" : r.error);
    }
  } finally {
    await chrome.close();
  }
})();
