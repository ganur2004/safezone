# Architecture

```
web simulator (React + MapLibre)        Alexa+ (optional)
        │ HTTPS /api/chat                     │ MCP Streamable HTTP
        ▼                                     │
agent service (Bedrock Converse + Polly) ─────┤
        │ MCP client                          │
        ▼                                     ▼
              MCP server "safezone"  (POST /mcp, stateless)
                            │
   NASA FIRMS · NWS · USGS · Open-Meteo · Amazon Location · OSM
```

## Why an MCP server is the core

The hackathon's Alexa+ track accepts a self-hosted MCP server. Alexa+ may not be reachable for us,
and the judges may not have it either, so the same server also backs a web simulator that shows a
map. The server never knows who is calling it.

## The one contract that matters

Every tool returns a `SafetyToolResult` (`shared/src/types.ts`):

- `summary` — one or two sentences, meant to be spoken; this is what Alexa+ reads out.
- `map.layers` — GeoJSON layers the simulator draws; `map.view` tells it where to fly.
- `data` — the structured numbers behind the summary.
- `sources` — where each number came from, shown in the UI.
- `demo` — true when the answer came from recorded fixtures.

On the wire, `summary` goes into `content[0].text` and the whole object into `structuredContent`,
which is declared through the tool's `outputSchema`.

## Statelessness

`POST /mcp` builds a fresh `McpServer` and transport per request, with no session id generator and
`enableJsonResponse: true`. Alexa+ keeps the conversation itself and sends no session id, and this
shape deploys unchanged to Lambda. The only shared state is a 5-minute in-memory response cache,
keyed by tool plus coordinates rounded to 0.01°.

## The tools

| Tool                 | Source                       | Notes                                             |
| -------------------- | ---------------------------- | ------------------------------------------------- |
| `geocode`            | Amazon Location / Open-Meteo | Amazon when a key is set, Open-Meteo otherwise    |
| `get_fire_hotspots`  | NASA FIRMS VIIRS             | bbox query, real-distance filter, 2 km clustering |
| `get_weather_alerts` | NOAA / NWS                   | US only; zone alerts carry no polygon             |
| `get_earthquakes`    | USGS                         | already GeoJSON                                   |
| `get_air_quality`    | Open-Meteo Air Quality       | US AQI mapped to EPA bands and colours            |
| `get_wind`           | Open-Meteo Forecast          | reports both `from_deg` and `to_deg`              |
| `find_safe_places`   | OpenStreetMap via Overpass   | `avoid` zones drop and down-rank places           |

## Layering inside the server

- `sources/` — one client per external API. I/O, timeouts, cache; nothing else.
- `tools/` — one MCP tool per file, plus a sibling module with the pure logic (filtering,
  clustering, phrasing) so it can be unit-tested against fixtures.
- `demo/` — scenario lookup for `DEMO_MODE`; picks the nearest recorded scenario.
- `risk/` — the rule set behind `assess_risk` (milestone M5).

## The agent service

`agent/` is the part Alexa+ plays for a real device: it decides which tools to call. `POST /api/chat`
takes the whole conversation and returns a spoken reply plus every tool result, so the service holds
no session state.

With `BEDROCK_ENABLED=true` it runs a Converse tool-use loop: list the MCP tools, hand them to the
model as `toolConfig`, run whatever the model asks for, feed the results back, and stop at five
iterations. The Bedrock client is injected rather than constructed inside the loop, which is what
lets the loop be tested without AWS credentials.

With `BEDROCK_ENABLED=false` the scripted fallback from SPEC 7.4 picks tools with keyword rules.
Because the endpoint is stateless it re-derives context from the history: the place comes from the
most recent message that names one, and "away from the fire" fetches the fire clusters on the spot
to fill the `avoid` parameter. This is the path the keyless demo runs.

`POST /api/tts` returns Polly audio, or 503 when Polly is not configured — the simulator reads that
as "use the browser voice".

## The simulator

`web/` is a Vite + React app with a single MapLibre instance. It holds no hazard logic of its own:
it renders whatever layers a `SafetyToolResult` carries, keyed by `MapLayer.id`, replacing a
source's data when the id repeats and adding a source when it does not. `web/src/map/layers.ts` maps
each layer kind to its MapLibre layers, so adding a hazard type is a change in one file.

Voice in is the browser's Web Speech API, voice out is Polly with a `speechSynthesis` fallback, so
the demo speaks even with no AWS account. Factors accumulate per tool and reset when the place
changes, so a follow-up about the wind does not drop the fire that is still burning.

## Failure behaviour

A dead source raises `SourceUnavailableError` and becomes an MCP error result with a readable
sentence — never a stack trace, never a URL containing a key. Missing configuration is marked
`retryable: false` so the message does not promise that retrying will help. `assess_risk` will
degrade to partial data rather than fail as a whole.

Two sources needed specific handling. The National Weather Service answers HTTP 400 "out of bounds"
for points outside the US, which is an answer rather than a failure, so the HTTP layer can pass
selected 4xx codes through to the caller. Public Overpass instances answer 406 for a User-Agent
containing an email in parentheses and 504 whenever they are busy, so the client sends a plain token
agent and walks a list of mirrors.
