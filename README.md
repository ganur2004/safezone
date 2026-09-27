# SafeZone

**A voice safety assistant with a map.** Ask whether a place is safe, and SafeZone pulls live hazard
data from several open sources, reasons about the risk, answers in one or two spoken sentences, and
draws everything on a map.

SafeZone is built as a **self-hosted MCP server** (spec revision `2025-11-25`, Streamable HTTP), so
the same tools serve Alexa+ and our own web simulator. The simulator adds what a voice-only
assistant cannot show: the map.

> ⚠️ SafeZone is a demonstration project. It does not replace official emergency services.
> In an emergency, call 911 and follow the instructions of local authorities.

## Status

Milestones **M1**–**M7** are complete: nine MCP tools including `assess_risk` and `get_route`, an
agent service that runs the tool loop, a simulator that listens, answers out loud and draws the
result, recorded fixtures so the whole thing runs with no API keys, and the AWS infrastructure as
CDK code. What is left is M8, the submission itself. See `SPEC.md` section 12 for the roadmap.

**Not deployed yet.** `infra/` synthesizes and both Lambda bundles have been invoked locally with
Function URL payloads, but nobody has run `cdk deploy` against a real account — there are no AWS
credentials on the development machines. The same goes for the Amazon Bedrock and Amazon Polly
paths, which are written and unit-tested against fakes. The default configuration uses the scripted
agent and the browser voice, which is what the demo below runs. See `docs/DEPLOY.md`.

**Alexa+ is not connected.** The MCP server is what the Alexa+ track asks for and it is ready to
register, but the developer preview is not available to us, so the simulator is the demo. The rules
allow that.

| Tool                 | Source                                     | State   |
| -------------------- | ------------------------------------------ | ------- |
| `geocode`            | Amazon Location, Open-Meteo as fallback    | ✅ done |
| `get_fire_hotspots`  | NASA FIRMS (VIIRS)                         | ✅ done |
| `get_weather_alerts` | NOAA / National Weather Service            | ✅ done |
| `get_earthquakes`    | USGS                                       | ✅ done |
| `get_air_quality`    | Open-Meteo Air Quality (US AQI, EPA bands) | ✅ done |
| `get_wind`           | Open-Meteo Forecast                        | ✅ done |
| `find_safe_places`   | OpenStreetMap via Overpass                 | ✅ done |
| `assess_risk`        | all of the above                           | ✅ done |
| `get_route`          | Amazon Location Routes, OSRM as fallback   | ✅ done |

Only NASA FIRMS needs an API key. Everything else works with no credentials at all, and
`DEMO_MODE=true` serves recorded responses for every tool.

## Quick start (no API keys)

```bash
npm install
npm run build
npm run demo
```

That starts the MCP server with recorded data, the agent in scripted mode, and the simulator. Open
http://localhost:5173 and try one of the three suggested questions, by voice or by typing.

Other useful commands:

```bash
npm run smoke         # initialize + tools/list + tools/call against a running server
npm run inspector     # MCP Inspector; connect to http://localhost:8787/mcp (Streamable HTTP)
npm run dev:server    # the MCP server on :8787
npm run dev:agent     # the agent on :8788
npm run dev:web       # the simulator on :5173
```

## How the risk level is decided

`assess_risk` is the tool that matters. It calls the others in parallel and applies an explicit rule
set (SPEC 6) rather than averaging anything, so every level can be explained:

- a hotspot within 10 km, or within 30 km and **upwind** in a wind of 15 km/h or more → **high**
- an official alert carries its own severity through; AQI above 100 raises the level in EPA bands;
  a magnitude 5 quake within 100 km in the last day is moderate, magnitude 6 is high
- two high factors from **different** sources compound to **extreme**

"Upwind" is the part worth reading twice: weather APIs report the direction the wind comes **from**,
so a fire sitting in that direction is the one whose smoke reaches you. Getting it backwards would
invert the most important judgement the product makes, so it is tested both at the rule level and
through the whole tool.

A source that fails is left out and named in the answer rather than failing the assessment.

## How a question is answered

```
you speak  →  web simulator  →  POST /api/chat  →  agent  →  MCP tools  →  open data
                    ↑                                  ↓
              map + spoken reply  ←────────────  SafetyToolResult
```

Every tool returns one `SafetyToolResult`: a short spoken summary, the map layers to draw, the
numbers behind it, and where they came from. Alexa+ reads the summary; the simulator also draws the
layers. The browser holds no hazard logic of its own.

The agent picks the tools — with Amazon Bedrock when `BEDROCK_ENABLED=true`, otherwise with the
scripted fallback from SPEC 7.4, so the whole flow runs without an AWS account.

## Voice

Input uses the browser's Web Speech API (Chrome and Safari; elsewhere the text box is the way in).
Hold the microphone button and speak. Output prefers Amazon Polly through `POST /api/tts`; when
Polly is not configured the agent answers 503 and the simulator falls back to the browser's own
voice, so the demo always talks.

## The map

A full-screen dark map with a risk panel (`web/`, Vite + React + MapLibre). Fire hotspots are sized
by radiative power, alert polygons coloured by severity, the wind arrow flows in the direction the
smoke is going, the recommended hospital is highlighted, and the route to it is drawn as a road
line. Your location pulses like a device that is listening.

Clicking a feature opens a popup with its details and its source, one at a time. The legend lists
only the layers actually on the map, and each entry switches its layer off — with five hazards drawn
at once, hiding the fires to see the alert polygon underneath is the difference between a map and a
mess. Every animation stops for `prefers-reduced-motion`.

## Running with live data

```bash
cp .env.example .env
DEMO_MODE=false npm run demo
```

Six of the seven tools work immediately — NWS, USGS, Open-Meteo and Overpass need no keys. These
optional settings add the rest:

- `FIRMS_MAP_KEY` — free from https://firms.modaps.eosdis.nasa.gov/api/map_key/, enables
  `get_fire_hotspots`. Without it that one tool answers with a clear error and the others are
  unaffected.
- `AMAZON_LOCATION_API_KEY` — makes `geocode` use Amazon Location Service instead of Open-Meteo.
- `NWS_USER_AGENT` — the National Weather Service asks for a contact address in the User-Agent.
- `BEDROCK_ENABLED=true` — the agent picks tools with a Bedrock model instead of the scripted
  fallback. The model in `BEDROCK_MODEL_ID` must be enabled in your region under Bedrock "Model
  access", and the service needs `bedrock:InvokeModel`.
- `POLLY_ENABLED=true` — replies are spoken by Amazon Polly instead of the browser voice.

Weather alerts cover US locations only; elsewhere the tool says so instead of failing.

## Demo fixtures

`server/fixtures` holds recorded API responses for four scenarios: Sacramento, Los Angeles, Chicago
(nothing active) and Hilo, Hawaii (a real hurricane watch). Refresh them with:

```bash
npm run record-fixtures
```

Everything except the fire CSVs is recorded from the live keyless APIs; the fire CSVs are
placeholders until the script runs with a `FIRMS_MAP_KEY`.

## Deploying to AWS

The whole stack is AWS CDK in `infra/`: CloudFront and S3 for the simulator, a Lambda Function URL
each for the agent and the MCP server, log groups, and an optional budget alert.

```bash
npm install
npm run deploy
```

`docs/DEPLOY.md` has the runbook: bootstrapping, the NASA FIRMS key in Secrets Manager, Bedrock
model access, every context flag, and how to tear it all down.

## Repository layout

```
shared/   the SafetyToolResult contract and geo helpers, used by every package
server/   the MCP server: tools, source clients, demo fixtures
agent/    the agent service: Bedrock tool loop, scripted fallback, Polly
web/      the simulator: map, risk panel, voice
infra/    the AWS CDK stack
scripts/  demo runner, smoke test, fixture recorder
docs/     architecture notes, deployment runbook, friction log, Devpost draft
```

## Development

```bash
npm test         # vitest: parsing, risk logic, contracts, the agent loop, the browser client
npm run lint     # eslint + prettier
npm run typecheck
```

## License

MIT — see `LICENSE`.
