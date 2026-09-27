/** MCP tool `get_fire_hotspots` — active fire hotspots around a point (spec 5.3). */
import { z } from "zod";
import { distanceProperties, spellDirection } from "@safezone/shared";
import type { LatLon, MapLayer, SafetyToolResult, SourceRef } from "@safezone/shared";
import { config } from "../config.js";
import { bboxOfPoints, circleFeature, featureCollection, pointFeature } from "../lib/geojson.js";
import { ToolInputError } from "../lib/errors.js";
import {
  FIRMS_DATASET,
  FIRMS_HUMAN_URL,
  FIRMS_MAX_DAYS,
  FIRMS_MIN_DAYS,
  FIRMS_SOURCE_NAME,
  fetchFirmsHotspots,
  type FirmsHotspot,
} from "../sources/firms.js";
import { loadFireFixture } from "../demo/fixtures.js";
import { clusterHotspots, fireSummary, filterHotspots } from "./fires.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude of the place to check."),
  lon: z.number().min(-180).max(180).describe("Longitude of the place to check."),
  radius_km: z
    .number()
    .min(1)
    .max(500)
    .default(50)
    .describe("Search radius in kilometres around the point. Defaults to 50."),
  days: z
    .number()
    .int()
    .min(FIRMS_MIN_DAYS)
    .max(FIRMS_MAX_DAYS)
    .default(1)
    .describe("How many past days of detections to include, 1 to 10. Defaults to 1."),
};

export const getFireHotspotsTool = defineTool({
  name: "get_fire_hotspots",
  title: "Active fire hotspots",
  description:
    "Returns active wildfire hotspots detected by NASA satellites around a location, with the " +
    "distance and direction of the closest one. Use for follow-up questions specifically about " +
    "fires, smoke sources or how close a wildfire is. For a general 'is it safe here' question " +
    "use assess_risk instead.",
  inputSchema,
  async handler({ lat, lon, radius_km: radiusKm, days }): Promise<SafetyToolResult> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new ToolInputError("I need a valid latitude and longitude to check for fires.");
    }
    const origin: LatLon = { lat, lon };
    const { hotspots, demo } = await loadHotspots(origin, radiusKm, days);

    const filtered = filterHotspots(origin, hotspots, radiusKm);
    const clusters = clusterHotspots(origin, filtered);
    const closest = filtered[0];

    const layers: MapLayer[] = [
      {
        id: "radius",
        kind: "radius",
        geojson: featureCollection([circleFeature(origin, radiusKm, { label: "search radius" })]),
      },
      {
        id: "fires",
        kind: "fires",
        geojson: featureCollection(
          filtered.map((hotspot) =>
            pointFeature(hotspot, {
              frp: hotspot.frp,
              confidence: hotspot.confidence,
              acquired_at: hotspot.acquiredAt,
              ...distanceProperties(hotspot.distanceKm),
              direction: hotspot.direction,
              source: FIRMS_SOURCE_NAME,
            }),
          ),
        ),
      },
    ];

    const sources: SourceRef[] = [
      {
        name: `${FIRMS_SOURCE_NAME} (${FIRMS_DATASET})`,
        url: FIRMS_HUMAN_URL,
        fetchedAt: new Date().toISOString(),
      },
    ];

    const result: SafetyToolResult = {
      summary: fireSummary(filtered, clusters, radiusKm, days),
      severity:
        filtered.length === 0 ? "none" : closest && closest.distanceKm <= 10 ? "high" : "moderate",
      map: {
        view: viewFor(origin, radiusKm, filtered),
        layers,
      },
      data: {
        count: filtered.length,
        radius_km: radiusKm,
        days,
        clusters: clusters.map((cluster) => ({
          lat: cluster.lat,
          lon: cluster.lon,
          count: cluster.count,
          frp: cluster.frp,
          distance_km: cluster.distanceKm,
          bearing_deg: cluster.bearingDeg,
          direction: cluster.direction,
        })),
        closest: closest
          ? {
              distance_km: Math.round(closest.distanceKm * 10) / 10,
              bearing_deg: closest.bearingDeg,
              direction: closest.direction,
              direction_spoken: spellDirection(closest.direction),
              frp: closest.frp,
              acquired_at: closest.acquiredAt,
            }
          : null,
      },
      sources,
    };
    return demo ? { ...result, demo: true } : result;
  },
});

/** Reads fixtures in DEMO_MODE, otherwise calls FIRMS (spec 5.5). */
async function loadHotspots(
  origin: LatLon,
  radiusKm: number,
  days: number,
): Promise<{ hotspots: FirmsHotspot[]; demo: boolean }> {
  if (config.demoMode) {
    return { hotspots: await loadFireFixture(origin), demo: true };
  }
  return {
    hotspots: await fetchFirmsHotspots({ ...origin, radiusKm, days }),
    demo: false,
  };
}

function viewFor(origin: LatLon, radiusKm: number, hotspots: LatLon[]) {
  if (hotspots.length > 0) {
    const bbox = bboxOfPoints([origin, ...hotspots]);
    if (bbox) return { bbox };
  }
  return {
    center: [origin.lon, origin.lat] as [number, number],
    zoom: radiusKm <= 25 ? 10 : 9,
  };
}
