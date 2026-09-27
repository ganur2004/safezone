/** MCP tool `get_route` — how to get from here to there (SPEC 5.3, priority P2). */
import { z } from "zod";
import { formatKmAndMiles, type LatLon, type SafetyToolResult } from "@safezone/shared";
import type { Feature } from "geojson";
import { config } from "../config.js";
import { bboxOfPoints, featureCollection, pointFeature } from "../lib/geojson.js";
import {
  AMAZON_ROUTES_SOURCE,
  AMAZON_ROUTES_URL,
  OSRM_SOURCE,
  OSRM_URL,
  calculateRoute,
  isAmazonRoutingConfigured,
  type Route,
} from "../sources/routing.js";
import { defineTool } from "./registry.js";

const point = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const inputSchema = {
  from: point.describe("Where the journey starts, usually the user's location."),
  to: point.describe("Where they are going, for example the hospital you just found."),
  label: z
    .string()
    .max(120)
    .optional()
    .describe("Name of the destination, so the answer can say where the route leads."),
};

export const getRouteTool = defineTool({
  name: "get_route",
  title: "Route to a place",
  description:
    "Returns the driving route between two points, with the distance and how long it takes, and " +
    "draws the road line on the map. Use after find_safe_places when the user asks how to get " +
    "there or how far away it is by road.",
  inputSchema,
  async handler({ from, to, label }): Promise<SafetyToolResult> {
    const { route, demo } = await loadRoute(from, to);
    const destination = label ?? "your destination";

    const line: Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.coordinates },
      properties: {
        distance_km: round(route.distanceKm),
        duration_min: Math.round(route.durationMin),
        label: destination,
        source: route.source.name,
      },
    };

    const result: SafetyToolResult = {
      summary:
        `${destination} is ${formatKmAndMiles(route.distanceKm)} by road, ` +
        `about ${Math.round(route.durationMin)} minutes of driving.`,
      severity: "none",
      map: {
        view: {
          bbox: bboxOfPoints(
            route.coordinates.map(([lon, lat]) => ({ lat, lon })),
            2,
          ),
        },
        layers: [
          { id: "route", kind: "route", geojson: featureCollection([line]) },
          {
            id: "route-ends",
            kind: "places",
            geojson: featureCollection([
              pointFeature(to, { name: destination, type: "hospital", selected: true }),
            ]),
          },
        ],
      },
      data: {
        distance_km: round(route.distanceKm),
        duration_min: Math.round(route.durationMin),
        to: { lat: to.lat, lon: to.lon, label: destination },
        provider: route.source.name,
      },
      sources: [{ ...route.source, fetchedAt: new Date().toISOString() }],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * In DEMO_MODE the route is a straight line rather than a recorded one: routes
 * depend on both endpoints, so recording every pair a judge might ask for is
 * not practical, and a direct line is honestly wrong in an obvious way.
 */
async function loadRoute(from: LatLon, to: LatLon): Promise<{ route: Route; demo: boolean }> {
  if (config.demoMode) {
    const { haversineKm } = await import("@safezone/shared");
    const distanceKm = haversineKm(from, to);
    return {
      route: {
        distanceKm,
        // Roughly city driving, so the spoken answer stays plausible.
        durationMin: (distanceKm / 35) * 60,
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
        source: isAmazonRoutingConfigured()
          ? { name: `${AMAZON_ROUTES_SOURCE} (straight line in demo mode)`, url: AMAZON_ROUTES_URL }
          : { name: `${OSRM_SOURCE} (straight line in demo mode)`, url: OSRM_URL },
      },
      demo: true,
    };
  }
  return { route: await calculateRoute(from, to), demo: false };
}
