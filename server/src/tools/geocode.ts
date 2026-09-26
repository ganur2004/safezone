/** MCP tool `geocode` — turn a place name into coordinates (spec 5.3). */
import { z } from "zod";
import type { SafetyToolResult, SourceRef } from "@safezone/shared";
import { config } from "../config.js";
import { ToolInputError } from "../lib/errors.js";
import { featureCollection, pointFeature } from "../lib/geojson.js";
import {
  AMAZON_LOCATION_SOURCE,
  AMAZON_LOCATION_URL,
  geocodeWithAmazonLocation,
  isAmazonLocationConfigured,
} from "../sources/amazonLocation.js";
import {
  OPEN_METEO_GEOCODING_SOURCE,
  geocodeWithOpenMeteo,
  openMeteoSource,
  parseOpenMeteoGeocoding,
  type GeocodedPlace,
} from "../sources/openMeteo.js";
import { loadJsonFixture, loadScenarios, scenarioForQuery } from "../demo/fixtures.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("A place name or address, for example 'Sacramento' or '123 Main St, Boise'."),
};

export const geocodeTool = defineTool({
  name: "geocode",
  title: "Find a place",
  description:
    "Converts a place name or address into coordinates. Use it when the user names a place and " +
    "you need its coordinates before calling another tool, and when they ask where a place is. " +
    "assess_risk already geocodes on its own, so there is no need to call this first for it.",
  inputSchema,
  async handler({ query }): Promise<SafetyToolResult> {
    const trimmed = query.trim();
    if (trimmed.length < 2) throw new ToolInputError("Tell me which place you mean.");

    const { place, source, demo } = await resolvePlace(trimmed);
    if (!place) {
      throw new ToolInputError(`I could not find a place called "${trimmed}".`);
    }

    const label = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
    const result: SafetyToolResult = {
      summary: `${label} is at the location I will use for the next answers.`,
      severity: "none",
      map: {
        view: { center: [place.lon, place.lat], zoom: 10 },
        layers: [
          {
            id: "home",
            kind: "home",
            geojson: featureCollection([
              pointFeature(place, { label, name: place.name, country: place.country }),
            ]),
          },
        ],
      },
      data: {
        name: place.name,
        label,
        lat: place.lat,
        lon: place.lon,
        country: place.country,
        country_code: place.countryCode,
        admin1: place.admin1 ?? null,
      },
      sources: [source],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

interface ResolvedPlace {
  place: GeocodedPlace | undefined;
  source: SourceRef;
  demo: boolean;
}

/**
 * Amazon Location when it is configured (it is the AWS service we want to show
 * off), Open-Meteo otherwise, recorded scenarios in DEMO_MODE (spec 5.3).
 */
async function resolvePlace(query: string): Promise<ResolvedPlace> {
  if (config.demoMode) {
    // Unknown queries fall back to the first scenario so the demo always moves on.
    const scenario = (await scenarioForQuery(query)) ?? (await loadScenarios())[0];
    const recorded = scenario
      ? await loadJsonFixture<Parameters<typeof parseOpenMeteoGeocoding>[0]>(scenario, "geocode")
      : undefined;
    const place = recorded ? parseOpenMeteoGeocoding(recorded) : undefined;
    return {
      place:
        place ??
        (scenario && {
          name: scenario.label.split("—")[0]?.trim() ?? scenario.label,
          lat: scenario.lat,
          lon: scenario.lon,
          country: "United States",
          countryCode: "US",
        }) ??
        undefined,
      source: openMeteoSource(`${OPEN_METEO_GEOCODING_SOURCE} (recorded)`),
      demo: true,
    };
  }
  if (isAmazonLocationConfigured()) {
    return {
      place: await geocodeWithAmazonLocation(query),
      source: {
        name: AMAZON_LOCATION_SOURCE,
        url: AMAZON_LOCATION_URL,
        fetchedAt: new Date().toISOString(),
      },
      demo: false,
    };
  }
  return {
    place: await geocodeWithOpenMeteo(query),
    source: openMeteoSource(OPEN_METEO_GEOCODING_SOURCE),
    demo: false,
  };
}
