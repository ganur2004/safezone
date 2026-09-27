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

- `shared/src/types.ts` — the contract; `shared/src/geo.ts` — distance, bearing, units, direction words
- `server/src/sources/*` — external API clients, I/O only: firms, nws, usgs, openMeteo, overpass, amazonLocation
- `server/src/tools/*` — one file per MCP tool (`getWind.ts`) plus its pure logic (`wind.ts`)
- `server/src/demo/fixtures.ts` — DEMO_MODE scenario lookup
- `server/fixtures/scenarios.json` — demo scenarios (Sacramento, Los Angeles, Chicago, Hilo)
- `agent/src/bedrock.ts` — the Converse tool loop; Bedrock is injected so tests can fake it
- `agent/src/scripted.ts` — the no-AWS fallback (SPEC 7.4); it must stay stateless
- `web/src/agent/client.ts` — the only place the browser talks to the agent
- `web/src/voice/speech.ts` — Web Speech input, Polly output with a browser fallback
- `web/src/map/layers.ts` — one entry per MapLayer kind; add a kind there, not in the component

## Source quirks worth remembering

- NWS: needs a contact in `User-Agent`, answers HTTP 400 outside the US — report "US only", not an error
- NWS: alerts tied to zones have `geometry: null` — keep them in `data`, draw nothing
- Overpass: 406 on a User-Agent containing an email in parentheses; send `SafeZone/0.1`. Busy
  instances answer 504, so `overpass.ts` tries mirrors in turn
- Open-Meteo wind: `wind_direction_10m` is where the wind comes FROM
- MapLibre must stay out of Vite's dependency pre-bundling, or its worker fails to load

## Conventions

- `summary`: max 2 sentences, no coordinates, distances in km **and** miles
- Tool descriptions say **when** to use the tool (SPEC 5.4) — the model picks tools from them
- Input errors → `ToolInputError`; a dead source → `SourceUnavailableError` (`retryable: false` for
  missing configuration); tools never throw raw
- `data` keys are snake_case, matching the input schema; internal types stay camelCase
- Distances ship as `distance_km` **and** `distance_mi` (`distanceProperties`); never re-derive one
  from the other in the browser, or a popup will disagree with the spoken summary
- Keep `/mcp` stateless: no per-session state outside the in-memory cache
- The map keys sources by `MapLayer.id`: the same id replaces data, a new id adds a source
- `/api/chat` is stateless: the browser sends the whole history, the agent re-derives context
- Pair results with tools through `resultTools`, never by zipping `toolsUsed` (a failed tool
  appears there but produces no result)
- No AWS credentials on the dev machines: anything touching Bedrock or Polly needs a fake in tests

## Commands

- `npm run demo` — server, agent and simulator with recorded data, no keys needed
- `npm run dev:server` / `npm run dev:web` — one at a time
- `npm test`, `npm run lint`, `npm run typecheck`
- `npm run smoke` — initialize + tools/list + tools/call against a running server
- `npm run inspector` — MCP Inspector, then connect to http://localhost:8787/mcp
- `npm run record-fixtures` — refresh demo fixtures from the live APIs
