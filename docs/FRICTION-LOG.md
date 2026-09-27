# Friction log

Problems we hit with **Amazon** tooling (Alexa+, AWS, Bedrock, Polly, Amazon Location) while
building SafeZone. Our own bugs do not belong here.

### 2026-09-26 — Alexa+ developer preview access from Kazakhstan

- **What we did:** looked for a way to register an Alexa+ MCP add-on from Kazakhstan.
- **What we expected:** a documented eligibility list, or a clear "preview is US-only" statement.
- **What happened:** the MCP toolkit docs describe `alexa-ai deploy`, but not which accounts or
  regions can use the preview. Still unresolved; asked on the Devpost discussions.
- **Time lost:** ~30 minutes.
- **What would have helped:** a one-line availability note at the top of the add-on overview page.
- **Workaround:** the hackathon rules also accept a self-hosted MCP server plus a simulator, which
  is now our primary path.

### 2026-09-26 — Amazon Location Places: which command geocodes?

- **What we did:** looked for the geocoding call in `@aws-sdk/client-geo-places`.
- **What we expected:** one obvious entry point.
- **What happened:** the package exports `GeocodeCommand`, `SearchTextCommand`, `SuggestCommand`,
  `AutocompleteCommand` and `SearchNearbyCommand`, and the developer guide discusses the REST API
  rather than the SDK commands, so picking the right one took reading the generated types.
  `GeocodeCommand` also accepts a per-request `Key`, which is what makes API-key auth work without
  IAM credentials — useful, but easy to miss.
- **Time lost:** ~20 minutes.
- **What would have helped:** a short "geocode a place name" snippet in the Places API docs that
  names the SDK command and shows API-key auth.

### 2026-09-27 — Bedrock Converse: `Tool` is awkward to build in TypeScript

- **What we did:** built a `toolConfig` from the MCP tool list for `ConverseCommand`.
- **What we expected:** an object literal to type-check against `Tool`.
- **What happened:** `Tool` is a tagged union whose members each include a `$unknown` variant, so a
  plain literal fails with "Property '$unknown' is missing". The fix is an explicit return type
  annotation on the map callback. Separately, the JSON Schema for a tool has to be cast to
  `DocumentType`, which is re-exported from `@smithy/types` rather than from the Bedrock package.
- **Time lost:** ~15 minutes.
- **What would have helped:** a TypeScript snippet in the Converse tool-use documentation that
  builds `toolConfig` from a list, rather than one hand-written literal.

### 2026-09-27 — Lambda adapter and the MCP SDK disagree about headers

- **What we did:** put the MCP server behind a Lambda Function URL with an Express adapter.
- **What we expected:** the same server that works locally to work on Lambda.
- **What happened:** every `POST /mcp` came back `415 Unsupported Media Type: Content-Type must be
application/json`, even though the header was plainly there. The adapter fills `req.headers` but
  leaves `req.rawHeaders` empty, and the SDK's Node transport converts the request to a Web
  standard `Request` using `rawHeaders`. `GET /health` worked the whole time, which made it look
  like a routing problem rather than a header one.
- **Time lost:** ~40 minutes, and it would have been much worse if we had found it after deploying
  instead of by invoking the bundle locally.
- **What would have helped:** a note in the MCP TypeScript SDK's docs that the Node transport reads
  `rawHeaders`, since that is what decides whether an adapter works with it.
- **Also:** esbuild emitting ESM plus a CommonJS dependency that calls `require` at runtime fails
  only at invocation time, with "Dynamic require of http is not supported". A `createRequire` banner
  fixes it; nothing warns at build time.
