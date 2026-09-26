# SafeZone

Full spec: SPEC.md. Read the relevant section before changing code.

- TypeScript strict, npm workspaces: shared, server, agent, web
- All tool results must match SafetyToolResult in shared/src/types.ts
- Wind direction from APIs is where wind comes FROM (see SPEC 6.2)
- Never commit secrets; config via .env (see .env.example)
- Every tool must work in DEMO_MODE using server/fixtures
- Run `npm test` and `npm run lint` before finishing a task
- User-facing text in English; code comments in English

## Where things live

- `shared/src/types.ts` — the contract; `shared/src/geo.ts` — distance, bearing, units
- `server/src/sources/*` — external API clients (I/O only)
- `server/src/tools/*` — one file per MCP tool; pure logic split out so it is testable
- `server/src/demo/fixtures.ts` — DEMO_MODE scenario lookup
- `server/fixtures/scenarios.json` — demo scenarios (Sacramento, Los Angeles, calm)

## Source quirks worth remembering
- NWS: needs a contact in `User-Agent`, answers HTTP 400 outside the US — report "US only", not an error
- NWS: alerts tied to zones have `geometry: null` — keep them in `data`, draw nothing
- Overpass: 406 on a User-Agent containing an email in parentheses; send `SafeZone/0.1`. Busy
  instances answer 504, so `overpass.ts` tries mirrors in turn
- Open-Meteo wind: `wind_direction_10m` is where the wind comes FROM

## Conventions

- `summary`: max 2 sentences, no coordinates, distances in km **and** miles
- Tool descriptions say **when** to use the tool (SPEC 5.4) — the model picks tools from them
- Input errors → `ToolInputError`; a dead source → `SourceUnavailableError` (`retryable: false` for
  missing configuration); tools never throw raw
- `data` keys are snake_case, matching the input schema; internal types stay camelCase
- Keep `/mcp` stateless: no per-session state outside the in-memory cache

## Commands

- `npm run dev` — MCP server on :8787
- `npm test`, `npm run lint`, `npm run typecheck`
- `npm run smoke` — initialize + tools/list + tools/call against a running server
- `npm run inspector` — MCP Inspector, then connect to http://localhost:8787/mcp
