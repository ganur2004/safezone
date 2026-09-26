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

## Layering inside the server

- `sources/` — one client per external API. I/O, timeouts, cache; nothing else.
- `tools/` — one MCP tool per file, plus a sibling module with the pure logic (filtering,
  clustering, phrasing) so it can be unit-tested against fixtures.
- `demo/` — scenario lookup for `DEMO_MODE`; picks the nearest recorded scenario.
- `risk/` — the rule set behind `assess_risk` (milestone M5).

## Failure behaviour

A dead source raises `SourceUnavailableError` and becomes an MCP error result with a readable
sentence — never a stack trace, never a URL containing a key. `assess_risk` will degrade to partial
data rather than fail as a whole.
