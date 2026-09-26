/** MCP tool `get_earthquakes` — recent quakes near a point (spec 5.3). */
import { z } from "zod";
import type { LatLon, SafetyToolResult } from "@safezone/shared";
import { config } from "../config.js";
import { bboxOfPoints, featureCollection, pointFeature } from "../lib/geojson.js";
import {
  USGS_SOURCE_NAME,
  USGS_URL,
  fetchQuakes,
  parseUsgsQuakes,
  type Quake,
} from "../sources/usgs.js";
import { loadNearestJsonFixture } from "../demo/fixtures.js";
import { quakeSeverity, quakesSummary } from "./quakes.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude of the place to check."),
  lon: z.number().min(-180).max(180).describe("Longitude of the place to check."),
  radius_km: z
    .number()
    .min(1)
    .max(1000)
    .default(200)
    .describe("Search radius in kilometres. Defaults to 200."),
  days: z.number().int().min(1).max(30).default(3).describe("How many past days to include."),
  min_magnitude: z
    .number()
    .min(0)
    .max(10)
    .default(2.5)
    .describe("Smallest magnitude to report. Defaults to 2.5."),
};

export const getEarthquakesTool = defineTool({
  name: "get_earthquakes",
  title: "Recent earthquakes",
  description:
    "Returns earthquakes recorded near a location recently, with the strongest one and how far " +
    "away it was. Use for follow-up questions about earthquakes, shaking or seismic activity.",
  inputSchema,
  async handler({
    lat,
    lon,
    radius_km: radiusKm,
    days,
    min_magnitude: minMagnitude,
  }): Promise<SafetyToolResult> {
    const point: LatLon = { lat, lon };
    const { quakes, demo } = await loadQuakes({ ...point, radiusKm, days, minMagnitude });
    const strongest = quakes[0];

    const result: SafetyToolResult = {
      summary: quakesSummary(quakes, radiusKm, days),
      severity: quakeSeverity(quakes),
      map: {
        view:
          quakes.length > 0
            ? { bbox: bboxOfPoints([point, ...quakes]) ?? undefined }
            : { center: [lon, lat], zoom: 7 },
        layers: [
          {
            id: "quakes",
            kind: "quakes",
            geojson: featureCollection(
              quakes.map((quake) =>
                pointFeature(quake, {
                  magnitude: quake.magnitude,
                  place: quake.place,
                  depth_km: Math.round(quake.depthKm * 10) / 10,
                  time: new Date(quake.time).toISOString(),
                  distance_km: Math.round(quake.distanceKm * 10) / 10,
                  url: quake.url,
                  source: USGS_SOURCE_NAME,
                }),
              ),
            ),
          },
        ],
      },
      data: {
        count: quakes.length,
        radius_km: radiusKm,
        days,
        min_magnitude: minMagnitude,
        strongest: strongest
          ? {
              magnitude: strongest.magnitude,
              place: strongest.place,
              time: new Date(strongest.time).toISOString(),
              distance_km: Math.round(strongest.distanceKm * 10) / 10,
              depth_km: Math.round(strongest.depthKm * 10) / 10,
            }
          : null,
      },
      sources: [{ name: USGS_SOURCE_NAME, url: USGS_URL, fetchedAt: new Date().toISOString() }],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

async function loadQuakes(query: {
  lat: number;
  lon: number;
  radiusKm: number;
  days: number;
  minMagnitude: number;
}): Promise<{ quakes: Quake[]; demo: boolean }> {
  if (config.demoMode) {
    const recorded = await loadNearestJsonFixture<Parameters<typeof parseUsgsQuakes>[0]>(
      query,
      "quakes",
    );
    const quakes = recorded ? parseUsgsQuakes(recorded, query) : [];
    return {
      quakes: quakes.filter(
        (quake) => quake.distanceKm <= query.radiusKm && quake.magnitude >= query.minMagnitude,
      ),
      demo: true,
    };
  }
  return { quakes: await fetchQuakes(query), demo: false };
}
