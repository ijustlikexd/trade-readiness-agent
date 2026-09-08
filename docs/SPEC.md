# Trade Readiness Agent — Algorithm & Contract Spec (v1)

Deterministic engine decides. LLM only explains. LLM can never change `decision`.

## 0. Conventions

- Runtime: Node ≥ 18, CommonJS, no TypeScript, no build step. Only dependency allowed: none (use global `fetch`). `dotenv` is NOT used; read `.env` with a 10-line loader in `src/lib/env.js`.
- All kline arrays are **oldest → newest** (last element = latest). Binance REST already returns oldest→newest.
- Kline object: `{ openTime, open, high, low, close, volume, turnover, closeTime }` (numbers; `turnover` = quote asset volume, index 7 in Binance kline array).
- `src/lib/*` are vendored shared modules — do not modify them; wrap if needed.
- Every number in output is rounded via `decimalsFromTick(tickSize)` from `exchangeInfo` (fallback 2 decimals).

## 1. Data layer — `src/binance/`

`IDataProvider` interface (duck-typed): `getSnapshot(symbol) → Snapshot`

```js
Snapshot = {
  symbol, fetchedAt (ISO), source: "rest" | "mcp",
  tickSize,                          // from exchangeInfo filters PRICE_FILTER
  price,                             // last trade price (ticker/price)
  klines: { "4h": Kline[300], "1h": Kline[500] },
  book: { bid, ask, spreadBps, bidDepthQuote, askDepthQuote },   // depth limit=20, notional sum
  funding: { rate, nextFundingTime, markPrice } | null,          // fapi premiumIndex
  oi: { series: [{ts, oi}] (oldest→newest, 1h × 24) } | null,   // fapi openInterestHist via lib/crypto-market-meta
}
```

REST endpoints (public, no key):
- `https://api.binance.com/api/v3/exchangeInfo?symbol=`
- `https://api.binance.com/api/v3/klines?symbol=&interval=&limit=`
- `https://api.binance.com/api/v3/ticker/price?symbol=`
- `https://api.binance.com/api/v3/depth?symbol=&limit=20`
- `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=`
- OI: `fetchBinanceOIHist(symbol, "1h", 24)` from `src/lib/crypto-market-meta.js`

All calls through `throttledFetchJson` from `src/lib/http-host-throttle.js`. `funding` / `oi` failures → `null` (never throw). Klines/price/book failure → throw (analysis impossible).

`src/binance/restProvider.js` — default.
`src/binance/mcpProvider.js` — Binance Agent OS MCP (Streamable HTTP, JSON-RPC 2.0, `Authorization: Bearer $BINANCE_MCP_TOKEN`). Implements `initialize` → `tools/list` → map tools by name heuristics (kline/candle, depth/orderbook, ticker, funding, openInterest) → build the same Snapshot. Unmapped fields fall back to REST for that field and set `source: "mcp+rest"`. If no token → `restProvider`. Also export `probe()` that prints tool names (for `scripts/mcp-probe.js`).

## 2. Indicators (per timeframe) — `src/analysis/indicators.js`

- `ema(closes, p)` from lib; EMA20, EMA50 on both TFs; EMA144, EMA169 on 1h (Vegas). Feed full array (500 bars on 1h ≥ 3× 169 keeps seed residue < 1%).
- `atr14` via `computeATR(kl, 14).atr` per TF.
- `volZ` = `computeVolumeRobustZ(kl1h)` (turnover, last 20 bars).

## 3. Market structure — `src/analysis/structure.js`

**Swings** (fractal): bar i is swing high if `high[i]` is strictly the max of `high[i-n..i+n]`, n = 3. Mirror for lows. Last n bars cannot be confirmed swings. Return `[{idx, ts, price, kind:"H"|"L"}]`.

**Swing bias**: take last 2 confirmed highs and last 2 lows. HH && HL → +1; LH && LL → −1; else 0.

**Trend per TF** = sum of:
- EMA20 > EMA50 ? +1 : −1
- close > EMA50 ? +1 : −1
- swingBias (−1/0/+1)

Result: ≥ 2 → `"bullish"`, ≤ −2 → `"bearish"`, else `"neutral"`.

**Range**: `rangeHigh/rangeLow` = max high / min low of last 30 bars (4h). **Breakout** flag if current close > previous rangeHigh (computed excluding last bar); breakdown mirror.

## 4. Support / Resistance — `src/analysis/snr.js`

Candidate levels: all swing highs/lows from 4h (weight 2.0) and 1h (weight 1.0), plus previous UTC day high & low (weight 1.5) and current 30-bar 4h rangeHigh/Low (weight 1.0). Age decay: `w *= 0.98 ^ ageIn4hBars`.

Clustering: sort by price; greedy merge while `|price − clusterMean| ≤ 0.5 × atr14(4h)`. Cluster → `{ level: weightedMean, zoneLow: min, zoneHigh: max, weight: Σw, touches: count, score: weight / maxWeight (0..1) }`.

Zone minimum width: if `zoneHigh − zoneLow < 0.25 × atr4h`, expand symmetrically to that width.

`support` = highest cluster with `level < price`; `resistance` = lowest cluster with `level > price`. `supports[]`/`resistances[]` = up to 3 each, nearest first.

## 5. Direction & trade plan — `src/analysis/plan.js`

Direction:
- 4h bullish → LONG; 4h bearish → SHORT
- 4h neutral → follow 1h if bullish/bearish; else `NONE`

LONG plan (SHORT is mirror using resistance as entry zone and supports as targets):
- `entryZone = [support.zoneLow, support.zoneHigh]`, `entry = support.zoneHigh`
- `invalidation = support.zoneLow − 0.5 × atr14(1h)`
- `target1` = nearest resistance with `level − entry ≥ 1.0 × atr4h`; `target2` = the next one (may be null)
- `rr = (target1 − entry) / (entry − invalidation)`; null if target1 missing
- `distanceAtr = (price − entry) / atr4h` (how far price sits above the entry; negative = already inside/below zone)

## 6. Confluence — `src/analysis/confluence.js`

Each factor returns `{ val: 0..100 | null, weight, note, status: "ok"|"warn"|"bad"|"na" }`. Total via `weightedAvailable` (lib) → `score` 0..100 plus `availWeight`. If `availWeight < 0.7`, report flag `lowCoverage: true`.

| Factor | Weight | Scoring (direction-relative; SHORT mirrors sign) |
|---|---:|---|
| HTF structure | 25 | 4h aligned 72 + 1h aligned 28; 4h neutral 40; 4h against 0 |
| SNR | 20 | `support.score × 100` (resistance for SHORT) |
| Vegas (1h EMA144/169) | 15 | price within 0.5 atr1h of channel AND channel slope (EMA144 now vs 12 bars ago) aligned → 100; aligned not near → 55; against → 0 |
| Volume | 15 | volZ ≥ 1 → 100; 0..1 → 65; −1..0 → 40; < −1 → 20 |
| Open interest | 10 | ΔOI% over 24h and Δprice% over 24h: OI↑ & price in direction → 100; OI↑ & price against → 40; OI↓ → 60; null if no data |
| Funding | 5 | LONG: rate ≤ 0.0001 → 100; ≤ 0.0003 → 60; ≤ 0.0005 → 20; > 0.0005 → 0 (`crowded=true`). SHORT: same on −rate. null if no data |
| Liquidity | 5 | spreadBps ≤ 2 → 100; ≤ 5 → 60; ≤ 10 → 20; > 10 → 0 |
| Risk/Reward | 5 | rr ≥ 3 → 100; ≥ 2.5 → 80; ≥ 2 → 60; ≥ 1.8 → 40; else 0; null if rr null |

## 7. Risk Gate — `src/risk/gate.js`

Evaluated **in order**; first hit wins for hard rules, WATCH rules accumulate. Returns `{ decision, hardReasons[], watchReasons[] }`.

Hard → `NO TRADE`:
1. `direction === "NONE"`
2. no `support` (LONG) / no `resistance` (SHORT)
3. `rr === null`
4. `spreadBps > 10`
5. `rr < 1.8`
6. `distanceAtr > 1.5` (entry too far below price for LONG; mirror for SHORT)

Soft → `WATCH` (any):
7. 4h and 1h trends conflict (one bullish, one bearish)
8. funding `crowded`
8b. 4h trend neutral while a direction was taken from 1h ("HTF neutral: direction from 1h only")
9. `distanceAtr > 0.5` (price not yet at zone → "waiting for pullback")
10. confluence `score < 70`
11. `lowCoverage`

Else → `TRADE READY`. Additionally if confluence `score < 50` → downgrade to `NO TRADE` (reason "confluence too low").

## 8. Result contract — `src/index.js` `analyze(symbol, {provider}) → Result`

```js
Result = {
  symbol, generatedAt, source, price,
  regime: string,               // e.g. "Bullish Pullback" | "Bearish Continuation" | "Range" (derive: 4h trend + (distanceAtr>0.5 ? "Pullback" : "At Level"); neutral → "Range")
  trend: { "4h": {...}, "1h": {...} },
  structure: { swings4h, swings1h, range, breakout, breakdown },
  snr: { support, resistance, supports, resistances },
  plan: { direction, entryZone, entry, invalidation, target1, target2, rr, distanceAtr },
  confluence: { score, availWeight, lowCoverage, factors: {htf, snr, vegas, volume, oi, funding, liquidity, rr} },
  gate: { decision, hardReasons, watchReasons },
  decision: "TRADE READY" | "WATCH" | "NO TRADE",
  raw: { atr4h, atr1h, volZ, spreadBps, funding, oiChangePct, priceChangePct24h },
}
```

Snapshot + Result are written to `runs/<symbol>-<ISO>.json` (audit trail).

## 9. Report & LLM — `src/output/report.js`, `src/agent/explain.js`

- `renderText(result, explanation?)` → the "TRADE PASSPORT" box (see raw spec §13 layout), factor lines with ✓ / ⚠ / ✗ by status.
- `explain(result)` → Gemini `generateContent` (`GEMINI_MODEL`, `thinkingConfig.thinkingBudget: 0`, `temperature: 0.2`, timeout 20 s, 1 retry). Prompt: system rule "You are explaining a deterministic analysis. Never change numbers or the decision. Output ≤ 120 words: 1 sentence regime, 2–3 bullet reasons, 1 sentence risk." Input = compact JSON of Result (no swings arrays). On any failure → deterministic template fallback; report shows `explanation.source: "gemini" | "template"`.
- `--no-llm` flag skips Gemini.

## 10. CLI — `src/cli.js`

```
node src/cli.js analyze SOLUSDT [--json] [--no-llm] [--provider rest|mcp]
node src/cli.js scan            # BTCUSDT ETHUSDT SOLUSDT, one-line summary each
node scripts/mcp-probe.js       # lists Binance MCP tools (needs BINANCE_MCP_TOKEN)
```

## 11. Tests — `node --test tests/`

Fixtures: `tests/fixtures/<SYMBOL>-snapshot.json` captured once from REST (script `scripts/capture-fixture.js`). Tests are pure (no network):
- swings: hand-built 15-bar array with known fractal → exact indices
- clustering: 3 levels within tolerance merge, 4th outside stays
- trend: synthetic monotonic series → bullish/bearish
- plan/rr: known support/resistance → exact rr
- gate: table-driven — each rule triggers the expected decision; LLM output must not affect decision
- weightedAvailable coverage: missing funding+oi → availWeight 0.85
- full pipeline on fixture → schema shape + decision ∈ set
