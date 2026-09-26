# SafeZone

**A voice safety assistant with a map.** Ask whether a place is safe, and SafeZone pulls live
hazard data from several open sources, reasons about the risk, answers in one or two spoken
sentences, and draws everything on a map.

SafeZone is built as a **self-hosted MCP server** (spec revision `2025-11-25`, Streamable HTTP), so
the same tools serve Alexa+ and our own web simulator. The simulator adds what a voice-only
assistant cannot show: the map.

> ⚠️ SafeZone is a demonstration project. It does not replace official emergency services.
> In an emergency, call 911 and follow the instructions of local authorities.

## Status

Milestone **M1 (skeleton)** is complete: the monorepo, the shared result contract, and the MCP
server with `get_fire_hotspots` backed by NASA FIRMS. See `SPEC.md` section 12 for the roadmap.

| Tool                                                                                                  | Source                                      | State   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------- |
| `get_fire_hotspots`                                                                                   | NASA FIRMS                                  | ✅ done |
| `geocode`, `get_weather_alerts`, `get_earthquakes`, `get_air_quality`, `get_wind`, `find_safe_places` | Amazon Location, NWS, USGS, Open-Meteo, OSM | M2      |
| `assess_risk`                                                                                         | all of the above                            | M5      |

## Quick start (no API keys)

```bash
npm install
npm run build
npm run demo          # MCP server on http://localhost:8787/mcp with recorded data
```

In another terminal:

```bash
npm run smoke         # initialize + tools/list + tools/call against the running server
```

Or explore the tools interactively with the official inspector:

```bash
npm run inspector     # then connect to http://localhost:8787/mcp (Streamable HTTP)
```

## Running with live data

```bash
cp .env.example .env
DEMO_MODE=false npm run dev
```

Six of the seven tools work immediately — NWS, USGS, Open-Meteo and Overpass need no keys.
Two optional keys add the rest:

- `FIRMS_MAP_KEY` — free from https://firms.modaps.eosdis.nasa.gov/api/map_key/, enables
  `get_fire_hotspots`. Without it that one tool answers with a clear error and the others are
  unaffected.
- `AMAZON_LOCATION_API_KEY` — makes `geocode` use Amazon Location Service instead of Open-Meteo.
- `NWS_USER_AGENT` — the National Weather Service asks for a contact address in the User-Agent.

Weather alerts cover US locations only; elsewhere the tool says so instead of failing.

## Demo fixtures

`server/fixtures` holds recorded API responses for four scenarios: Sacramento, Los Angeles,
Chicago (nothing active) and Hilo, Hawaii (a real hurricane watch). Refresh them with:

```bash
npm run record-fixtures
```

Everything except the fire CSVs is recorded from the live keyless APIs; the fire CSVs are
placeholders until the script runs with a `FIRMS_MAP_KEY`.

## Repository layout

```
shared/   the SafetyToolResult contract and geo helpers, used by every package
server/   the MCP server: tools, source clients, demo fixtures
scripts/  smoke test and fixture recorder
docs/     architecture notes, friction log, Devpost draft
```

## Development

```bash
npm test         # vitest: parsing, clustering, contract and protocol tests
npm run lint     # eslint + prettier
npm run typecheck
```

## License

MIT — see `LICENSE`.
