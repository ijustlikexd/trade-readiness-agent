# Trade Readiness Agent

> A risk-gated Binance market-structure agent. Deterministic math decides. The LLM only explains.
> Built for the **Binance Agent OS Mini Hackathon — Track A**.

Ask `Analyze SOLUSDT` and get a **TRADE PASSPORT**: market regime, support/resistance zones,
entry / invalidation / targets, risk-reward, an 8-factor confluence score, and a final verdict:

```
TRADE READY   |   WATCH   |   NO TRADE
```

Not BUY / SELL. The question it answers is *"is this actually a tradeable setup right now?"*

<!-- SCREENSHOT: docs/screenshot-passport.png -->

## Why

AI trading agents are opaque: a model reads candles and "feels" a level. This agent inverts that.

| Layer | Who decides | Can it be overridden? |
|---|---|---|
| Market data | Binance Agent OS MCP / Binance public REST | — |
| Structure, SNR, Vegas, volume, OI, funding, liquidity, RR | Deterministic engine (`src/analysis`) | No |
| **Risk Gate** (hard rules, RR ≥ 1.8, spread, distance, HTF conflict) | Deterministic (`src/risk/gate.js`) | **Never — not even by the LLM** |
| Explanation | Gemini (optional) | Text only; a guard re-asserts the engine's decision if the LLM disagrees |

Every run stores the raw snapshot + result in `runs/` so any verdict can be reproduced.

## Architecture

```
User ─ "Analyze SOLUSDT"
  │
  ▼
Data provider ──── Binance Agent OS MCP (bearer token)  ─┐
                └─ Binance public REST (fallback)         ├─▶ Snapshot (4H/1H klines, book, funding, OI)
                                                          ┘
  ▼
Analysis engine   structure → SNR clusters → plan (entry/stop/targets/RR) → 8-factor confluence
  ▼
Risk Gate         hard rules → NO TRADE · soft rules → WATCH · else TRADE READY
  ▼
LLM explanation   Gemini, ≤120 words, cannot touch numbers or decision (template fallback)
  ▼
TRADE PASSPORT    text report / --json
```

Details and every threshold: [docs/SPEC.md](docs/SPEC.md).

## Install

```bash
git clone <this repo>
cd trade-readiness-agent
cp .env.example .env        # add GEMINI_API_KEY (optional) and BINANCE_MCP_TOKEN (optional)
node -v                     # >= 18, zero npm dependencies
```

## Usage

```bash
node src/cli.js analyze SOLUSDT            # full passport with LLM explanation
node src/cli.js analyze BTCUSDT --no-llm   # deterministic only
node src/cli.js analyze ETHUSDT --json     # machine-readable Result
node src/cli.js scan                       # BTC / ETH / SOL one-liners
npm test                                   # pure unit tests, no network
```

### Binance Agent OS integration

Two ways to plug the agent into Agent OS:

1. **As an MCP consumer** — set `BINANCE_MCP_TOKEN` and the data provider pulls market data through
   `https://agent.binance.com/mcp/agentic` (`--provider mcp`, falls back to REST per field).
   `npm run mcp:probe` lists the tools the server exposes.
2. **Inside Claude Code** — this repo ships `.mcp.json` (Binance MCP server) and `CLAUDE.md`, so an
   agent session can call Binance tools directly and run the engine as a skill:
   ```bash
   claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
   # then /mcp → Authenticate → read-only permissions
   ```

<!-- SCREENSHOT: docs/screenshot-mcp.png -->

## Example output

<!-- PASTE real output here -->

## Demo

<!-- VIDEO LINK -->

## Security design

- Read-only. No order, transfer, or withdrawal capability exists in the codebase.
- Secrets live in `.env` (git-ignored); logs mask API keys.
- The LLM receives structured numbers and returns prose; it cannot change any field. A guard appends
  `(Engine decision stands: …)` if the prose contradicts the gate.
- All external calls go through a per-host throttle with timeouts and retry with backoff.
- Snapshot + decision are persisted per run for audit.

## Limitations

- v1 covers USDT pairs on 4H/1H; three symbols in `scan`.
- Support/resistance uses fractal swings + ATR clustering; no volume-profile yet.
- Open interest / funding come from USDⓈ-M futures; spot-only symbols get `n/a` and the confluence
  renormalises over available factors (coverage % is shown, never silently filled with 0).
- Not financial advice. The agent tells you when *not* to trade far more often than when to trade.

## Roadmap

Execution layer behind explicit user confirmation → Risk Gate → Agent OS permission scope → order.
Provider interfaces (`IDataProvider`, `IInferenceProvider`) are already separated for Bybit/OKX and
other LLMs.

## License

MIT
