# Devpost submission draft

> Draft, in English, finalised in milestone M8. Keep it honest about what runs live.

## Tagline

Ask out loud whether a place is safe — and see why on a map.

## The problem

Hazard information is scattered: satellite fire detections in one portal, official warnings in
another, air quality in a third. When smoke appears on the horizon, nobody opens four dashboards.

## What SafeZone does

SafeZone answers spoken questions about the safety of a place. It reads NASA satellite fire
detections, National Weather Service alerts, USGS earthquakes, and air quality and wind from
Open-Meteo; applies an explicit rule set; and replies in one or two sentences while drawing the
hazards, the wind direction and the nearest safe places on a map.

## How we built it

The core is a self-hosted MCP server (spec `2025-11-25`, Streamable HTTP, stateless) so the same
tools serve Alexa+ and our own web simulator. Each tool returns both a spoken summary and map
layers. The simulator's "brain" is Amazon Bedrock running a tool-use loop over MCP, with Amazon
Polly for speech and Amazon Location for geocoding and maps.

## Challenges

_To fill in from `docs/FRICTION-LOG.md`._

## What's next

_To fill in in M8._

## Disclaimer

A demonstration project. It does not replace official emergency services.
