# Demo script (90–120 s)

| t | Screen | Say |
|---|---|---|
| 0–10 | Title slide / README top | "AI trading agents are opaque: the model *feels* a level. This one can't." |
| 10–20 | README architecture block | "Trade Readiness Agent. Binance Agent OS data → deterministic engine → Risk Gate → LLM only explains." |
| 20–35 | Terminal: `node src/cli.js analyze SOLUSDT` | "Analyze SOLUSDT. Live 4H and 1H data from Binance." |
| 35–60 | Passport output, point at sections | "Structure, support/resistance zones, entry, invalidation, targets, R:R. Eight-factor confluence with coverage." |
| 60–75 | Gate reasons line | "And the Risk Gate. Here it says WATCH: price is still 0.8 ATR above the zone. The LLM cannot override this." |
| 75–90 | `node src/cli.js scan` | "Scan BTC, ETH, SOL in one go." |
| 90–105 | `/mcp` screenshot or `npm run mcp:probe` + `.mcp.json` | "Agent OS integration: the same engine runs inside Claude Code with the Binance MCP server, read-only permissions." |
| 105–120 | GitHub repo page | "Zero dependencies, unit-tested, every run persisted for audit. Repo link below." |

Tips: font size 18+, dark terminal, pre-run once so caches are warm, keep `--no-llm` as backup if Gemini is slow.
