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
