# Video script — 2:50

The structure from SPEC 14: problem (10s) → the three questions (2 min) → architecture and AWS
(30s) → what's next (10s). Narration is written to be read aloud at a normal pace; each block's
word count fits its slot.

## Before recording

```bash
npm install && npm run build && npm run demo
```

Open http://localhost:5173 in Chrome — voice input needs it — at a window size of 1440×900 or
larger. Then:

- Check the badge reads **DEMO DATA**. Recorded fixtures mean the demo cannot fail live on an API
  timeout, and it means the fires are where we expect them.
- Decide on voice or typing. Voice is the point of the product, so use the microphone if the room is
  quiet; the presets are the safety net if it is not.
- Turn Polly on (`POLLY_ENABLED=true`) if you have AWS credentials, otherwise the browser voice is
  fine and nobody will mind.
- One dry run, then record. Do not clear the map between questions — layers accumulating across the
  conversation is the thing to show.

---

## 0:00–0:10 — The problem

> **Screen:** the four source websites open in tabs, cycling quickly. NASA FIRMS, the NWS alerts
> page, an air quality map, a USGS map.

**Narration.** "Everything you need to know about a wildfire near your home is public. It is also
spread across four different dashboards. When smoke appears on the horizon, nobody opens four
dashboards."

---

## 0:10–2:10 — The demo

> **Screen:** SafeZone, full window. Nothing else on screen for the rest of this block.

### Question one (0:10–0:55)

**Do:** hold the microphone and ask — _"Is it safe around my home in Sacramento?"_

**Show, while it answers:** the map flying to Sacramento, the fire cluster appearing north-east, the
risk panel filling in.

**Narration, over the answer.** "One question. SafeZone checks satellite fire detections, official
weather alerts, air quality, wind and earthquakes at the same time, and answers out loud."

**Then point at the panel.** "It does not just give a verdict. Every factor that produced that risk
level is listed, with the recommendation for it, and every source it used is named."

> Let the spoken answer finish before talking over the next bit. Silence for a second here is fine.

### Question two (0:55–1:25)

**Do:** ask — _"How is the wind moving?"_

**Show:** the arrow, and that the fires from the first question are still on the map.

**Narration.** "It remembers where we are talking about. And the wind matters more than it looks:
weather services report the direction wind comes _from_, so the fire that is dangerous is the one
sitting upwind — the one whose smoke is coming to you. SafeZone raises the risk level for exactly
that case."

### Question three (1:25–2:10)

**Do:** ask — _"Where's the nearest hospital away from the fire?"_

**Show:** hospitals appearing, the recommended one highlighted, the route drawn to it.

**Narration.** "This is the question that shows what it understands. It takes the fire clusters it
found a minute ago, passes them back in as zones to avoid, and picks a hospital that is not in the
direction of the fire — even when a closer one is. Then it routes you there."

**Optional, if there is room:** click a fire hotspot to open its popup. "Everything on the map is
inspectable, down to the satellite pass that detected it."

---

## 2:10–2:40 — Architecture and AWS

> **Screen:** the architecture diagram from the README, then the AWS console or `cdk deploy` output.

**Narration.** "Underneath, SafeZone is a self-hosted MCP server — the 2025-11-25 specification, over
Streamable HTTP. That is what the Alexa+ track asks for, and it means the same nine tools serve
Alexa+ and the simulator you just watched. Every tool returns both a sentence to speak and the map
layers to draw, so the server never knows which client is asking.

The simulator's brain is Amazon Bedrock running a tool-use loop, with Polly for speech and Amazon
Location for geocoding and routing. All of it is on Lambda behind Function URLs, with CloudFront in
front of the simulator, described in CDK — one command to deploy, one to tear down."

---

## 2:40–2:50 — What's next

> **Screen:** back to the map, zoomed out over the western US.

**Narration.** "Next is registering the server with Alexa+ itself, and watching a place instead of
waiting to be asked — so the first time you hear about the fire is before you ask."

**End card.** SafeZone · MIT licensed · github.com/<owner>/safezone
Underneath, smaller: _A demonstration project. Not a substitute for official emergency services._

---

## Notes

- **Three minutes is a hard limit.** The blocks above total 2:50. If you overrun, cut the popup
  aside in question three first, then the second half of the architecture paragraph.
- Do not narrate over the assistant's own voice. The product talking is more convincing than a
  voice-over saying that it talks.
- Record at 1080p or better. The map is the whole point and small text on a dark background suffers
  at 720p.
