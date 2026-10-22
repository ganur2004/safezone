# Devpost submission

The text below is what goes into the Devpost form. Everything here is written to be pasted as-is.

---

## Name

SafeZone

## Tagline

Ask out loud whether a place is safe — and see why, on a map.

## Elevator pitch (200 characters)

A voice safety assistant that reads live wildfire, weather, air quality and earthquake data,
reasons about the risk, answers in one sentence, and draws it all on a map.

---

## Inspiration

Hazard information is public, free and completely scattered. Satellite fire detections live in one
NASA portal, official warnings in a National Weather Service feed, air quality somewhere else again.
When smoke appears on the horizon, nobody opens four dashboards. They ask someone.

That is a voice assistant's job, except a voice assistant has a real weakness here: it can tell you a
fire is eighteen kilometres north-east, but it cannot show you where north-east is relative to your
street. So we built the answer twice — once to be spoken, once to be drawn.

## What it does

You ask SafeZone whether a place is safe. It checks wildfire hotspots, official weather alerts, air
quality, wind and recent earthquakes at the same time, applies a rule set, and answers in one or two
spoken sentences. The map flies to the place and shows what it just said: hotspots sized by how much
energy they are putting out, alert polygons coloured by severity, an arrow for where the wind is
carrying the smoke.

Then you can keep talking. "How is the wind moving?" "Where's the nearest hospital away from the
fire?" — that last one is the question that shows what the system actually understands: it takes the
fire clusters it found a moment ago, feeds them in as zones to avoid, and picks a hospital that is
not in the direction of the fire, even if a closer one is.

## How we built it

The core is a **self-hosted MCP server** (specification revision 2025-11-25, Streamable HTTP,
stateless), which is what the Alexa+ track asks for. It exposes nine tools over eight open data
sources. Every tool returns the same shape: a short spoken summary, the map layers to draw, the
numbers behind them, and where they came from.

That one decision is what makes the project work. Alexa+ reads the summary. Our simulator draws the
layers. The server never knows which one is calling.

```
you speak  →  simulator  →  /api/chat  →  agent  →  MCP tools  →  open data
                   ↑                          ↓
            map + spoken reply  ←──────  SafetyToolResult
```

- **MCP server** — the tools, on AWS Lambda behind a Function URL. NASA FIRMS for satellite fire
  detections, NOAA/NWS for official alerts, USGS for earthquakes, Open-Meteo for air quality and
  wind, OpenStreetMap through Overpass for hospitals and shelters, Amazon Location Service for
  geocoding and routing.
- **Agent service** — plays the part Alexa+ plays for a real device, and Amazon Polly speaks the
  answer. Its Amazon Bedrock Converse tool-use loop is written and unit-tested; while our AWS account
  finishes verification for Bedrock, the live deployment runs the deterministic scripted fallback
  over the same MCP tools, and switching to Bedrock is one redeploy.
- **Simulator** — React and MapLibre. Web Speech API for listening, one map layer style per hazard
  kind, and a risk panel that shows the reasoning rather than just the verdict.
- **Infrastructure** — AWS CDK: CloudFront and S3 for the simulator, a Lambda Function URL each for
  the two services, log groups and a budget alert.

`assess_risk` is the tool that matters. It is not an average of scores — it is an explicit rule set,
so every answer can be justified: a hotspot within 10 km is high; a hotspot within 30 km that is
_upwind_ in a wind of 15 km/h or more is also high, because that is the one whose smoke reaches you;
two high factors from different sources compound to extreme.

## Challenges we ran into

**The wind direction is a trap.** Weather APIs report the direction wind comes _from_. Get it
backwards and the assistant confidently tells you the safe side of a fire is the dangerous one. It
is the single most consequential line in the codebase, so it is tested as a rule and again through
the whole tool, with a north-easterly and a south-westerly wind over the same fire.

**Deployment bugs that cannot happen locally.** Our Lambda adapter fills `req.headers` but leaves
`rawHeaders` empty, and the MCP SDK's transport builds its request from exactly that — so every call
returned "415 Content-Type must be application/json" while the health check looked perfectly fine.
We found it by invoking the bundled handler locally with a Function URL payload instead of waiting
for a deploy.

**Public data sources have opinions.** Overpass rejects a User-Agent containing an email in
parentheses with a 406, and answers 504 whenever it is busy. The National Weather Service replies
HTTP 400 outside the United States, which is an answer, not a failure — so the tool says "US
locations only" instead of erroring.

## Accomplishments we're proud of

The project explains itself. Every answer names the sources it used, every risk level lists the
factors that produced it, and the fixtures are real recorded API responses rather than invented
ones — including a genuine hurricane watch over Hawaii that we caught while recording.

It also runs with nothing. `npm install && npm run demo` starts the whole stack from recorded data
with no API keys and no AWS account, which means a judge can see it work in under a minute.

## What we learned

Designing for two very different clients at once — a voice assistant with no screen and a map with
no voice — forced a cleaner contract than either would have alone. Once every tool had to return
both a sentence and a geometry, a lot of design questions answered themselves.

## What's next for SafeZone

**Official alerts outside the United States.** SafeZone reads warnings from NOAA's National Weather
Service, and NOAA is a US agency — every country's warnings come from its own meteorological
service, so there is no single global feed to point at. Ask about Almaty today and the earthquake,
air quality, wind and hospital data all work, but the official-alerts line is empty and says so.
The way in is GDACS, the disaster alert system run by the EU's Joint Research Centre with the UN:
global, keyless, and it covers earthquakes, cyclones, floods, wildfires, volcanoes and droughts. It
reports at a different grain — "moderate flood in Thailand" rather than "Red Flag Warning in your
county" — so it belongs beside the national feeds rather than in place of them, with the national
service used wherever one publishes a machine-readable feed.

**Alexa+ itself.** Registering the MCP server with Alexa+ proper, and the MCP Apps extension so a
device with a screen can show the same map inside the conversation.

**Watching instead of answering.** Follow a place and speak up when its risk level changes, so the
first you hear about the fire is before you think to ask.

**Bedrock on in production.** Once account verification completes.

## Built with

TypeScript, Node.js, Model Context Protocol, AWS Lambda, Amazon Bedrock, Amazon Polly, Amazon
Location Service, AWS CDK, CloudFront, S3, React, Vite, MapLibre GL, NASA FIRMS, NOAA / National
Weather Service, USGS, Open-Meteo, OpenStreetMap / Overpass, Web Speech API.

## Prize categories

- **Alexa+ track** — a self-hosted MCP server, which the rules accept in place of an Agent Skill.
- **AWS Builder (mini challenge)** — Polly for speech, Location Service for geocoding and routing,
  and the whole deployment on Lambda, CloudFront, S3 and Secrets Manager, described in CDK. The
  Bedrock Converse tool loop is written and unit-tested; the live demo runs the scripted fallback
  until the account finishes verification for Bedrock. The integrations are documented in
  `docs/ARCHITECTURE.md` and `docs/DEPLOY.md`.
- **Open Source (mini challenge)** — a fix upstream in `serverless-http`, found while putting this
  project on Lambda. `ServerlessRequest` extends `http.IncomingMessage` and fills in `headers` but
  never `rawHeaders`, so anything reading that standard property sees nothing. Our MCP server
  answered every request with "415 Content-Type must be application/json" while the health check
  looked fine, because the MCP SDK's transport builds its WHATWG `Request` from `rawHeaders`. The
  pull request populates it, with a test.
  - Contribution: https://github.com/dougmoscrop/serverless-http/pull/315
  - Repository: `dougmoscrop/serverless-http` (MIT)

## Try it

- Live demo: https://d227d864bivil2.cloudfront.net
- Repository: https://github.com/ganur2004/safezone
- Video: https://youtu.be/uXzbvXpvTok

> SafeZone is a demonstration project. It does not replace official emergency services. In an
> emergency, call 911 and follow the instructions of local authorities.
