# SafeZone

Full spec: SPEC.md. Read the relevant section before changing code.

- TypeScript strict, npm workspaces: shared, server, agent, web, infra
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
- `server/src/risk/rules.ts` — the assess_risk rule set (SPEC 6); pure, and the tests are the spec
- `server/src/risk/inputs.ts` — maps tool `data` onto the rules' typed inputs
- `server/src/demo/fixtures.ts` — DEMO_MODE scenario lookup
- `server/fixtures/scenarios.json` — demo scenarios (Sacramento, Los Angeles, Chicago, Hilo)
- `agent/src/bedrock.ts` — the Converse tool loop; Bedrock is injected so tests can fake it
- `agent/src/scripted.ts` — the no-AWS fallback (SPEC 7.4); it must stay stateless
- `web/src/agent/client.ts` — the only place the browser talks to the agent
- `web/src/voice/speech.ts` — Web Speech input, Polly output with a browser fallback
- `web/src/map/layers.ts` — one entry per MapLayer kind; add a kind there, not in the component
- `web/src/map/animate.ts` — one rAF loop for every map animation; it honours reduced motion
- `infra/lib/safezone-stack.ts` — the whole AWS stack; `docs/DEPLOY.md` is the runbook

## Source quirks worth remembering

- NWS: needs a contact in `User-Agent`, answers HTTP 400 outside the US — report "US only", not an error
- NWS: alerts tied to zones have `geometry: null` — keep them in `data`, draw nothing
- Overpass: 406 on a User-Agent containing an email in parentheses; send `SafeZone/0.1`. Busy
  instances answer 504, so `overpass.ts` tries mirrors in turn
- Open-Meteo wind: `wind_direction_10m` is where the wind comes FROM
- The upwind rule compares the bearing TO the fire against the wind's FROM direction (SPEC 6.2);
  if you touch it, the integration test in assessRisk.test.ts must still pass both ways
- MapLibre must stay out of Vite's dependency pre-bundling, or its worker fails to load
- On Lambda the adapter leaves `rawHeaders` empty and the MCP transport reads exactly that, so
  `server/src/lambda.ts` rebuilds it — without that every call is a 415
- The Lambda bundle is one file at `/var/task`, so fixtures are found through `FIXTURES_DIR`
- esbuild emits ESM but some dependencies `require` at runtime; the stack injects a `createRequire`
  shim as a banner

## Conventions

- `summary`: max 2 sentences, no coordinates, distances in km **and** miles
- Tool descriptions say **when** to use the tool (SPEC 5.4) — the model picks tools from them
- Input errors → `ToolInputError`; a dead source → `SourceUnavailableError` (`retryable: false` for
  missing configuration); tools never throw raw
- `data` keys are snake_case, matching the input schema; internal types stay camelCase
- A new hazard source means a rule in `risk/rules.ts`, a mapping in `risk/inputs.ts` and a call in
  `assessRisk.ts` — a tool that only `assess_risk` forgets to call contributes nothing
- A new tool also goes in `server/test/mcp.test.ts` and `scripts/smoke.ts`, which both list them
- AWS-backed sources follow the geocode pattern: the Amazon service when a key is set, a keyless
  fallback otherwise, so the demo never depends on an account
- `assess_risk` must never fail because one source did: gather with allSettled and name the gaps
- Distances ship as `distance_km` **and** `distance_mi` (`distanceProperties`); never re-derive one
  from the other in the browser, or a popup will disagree with the spoken summary
- Keep `/mcp` stateless: no per-session state outside the in-memory cache
- The map keys sources by `MapLayer.id`: the same id replaces data, a new id adds a source
- `/api/chat` is stateless: the browser sends the whole history, the agent re-derives context
- Pair results with tools through `resultTools`, never by zipping `toolsUsed` (a failed tool
  appears there but produces no result)
- No AWS credentials on the dev machines: anything touching Bedrock or Polly needs a fake in tests
- A test that sets `process.env.DEMO_MODE` must import server modules **lazily**: static imports are
  hoisted above the assignment and the config is read at import time, so the tool would quietly
  call the real API instead

## Commands

- `npm run demo` — server, agent and simulator with recorded data, no keys needed
- `npm run dev:server` / `npm run dev:web` — one at a time
- `npm test`, `npm run lint`, `npm run typecheck`
- `npm run smoke` — initialize + tools/list + tools/call against a running server
- `npm run inspector` — MCP Inspector, then connect to http://localhost:8787/mcp
- `npm run record-fixtures` — refresh demo fixtures from the live APIs
- `npm run synth` / `npm run deploy` — CDK; synth works with no AWS credentials
