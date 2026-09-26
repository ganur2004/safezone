/** MCP tool `find_safe_places` — nearest hospitals, fire stations, shelters (spec 5.3). */
import { z } from "zod";
import type { LatLon, MapLayer, SafetyToolResult } from "@safezone/shared";
import { config } from "../config.js";
import { circleFeature, featureCollection, pointFeature } from "../lib/geojson.js";
import {
  OVERPASS_SOURCE_NAME,
  OVERPASS_URL,
  fetchSafePlaces,
  parseOverpassPlaces,
  type OsmPlace,
} from "../sources/overpass.js";
import { loadNearestJsonFixture } from "../demo/fixtures.js";
import { placesSummary, rankPlaces, type AvoidZone } from "./places.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude to search around."),
  lon: z.number().min(-180).max(180).describe("Longitude to search around."),
  type: z
    .enum(["hospital", "fire_station", "shelter", "any"])
    .default("any")
    .describe("Which kind of place to look for. Defaults to any."),
  radius_km: z
    .number()
    .min(1)
    .max(100)
    .default(25)
    .describe("Search radius in kilometres. Defaults to 25."),
  avoid: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radius_km: z.number().min(0).max(200),
      }),
    )
    .optional()
    .describe(
      "Hazard zones to stay away from, such as fire clusters. Places inside a zone are dropped " +
        "and places lying towards a zone are ranked lower.",
    ),
};

export const findSafePlacesTool = defineTool({
  name: "find_safe_places",
  title: "Nearby safe places",
  description:
    "Returns the nearest hospitals, fire stations and shelters, optionally avoiding hazard zones. " +
    "Use when the user asks where to go, where the nearest hospital or shelter is, or asks for one " +
    "away from a fire — pass the fire cluster coordinates in `avoid` for that.",
  inputSchema,
  async handler({ lat, lon, type, radius_km: radiusKm, avoid }): Promise<SafetyToolResult> {
    const point: LatLon = { lat, lon };
    const avoidZones: AvoidZone[] = (avoid ?? []).map((zone) => ({
      lat: zone.lat,
      lon: zone.lon,
      radiusKm: zone.radius_km,
    }));

    const { places, demo } = await loadPlaces(point, radiusKm, type);
    const ranked = rankPlaces(point, places, avoidZones);

    const layers: MapLayer[] = [
      {
        id: "places",
        kind: "places",
        geojson: featureCollection(
          ranked.map((place, index) =>
            pointFeature(place, {
              name: place.name,
              type: place.type,
              distance_km: Math.round(place.distanceKm * 10) / 10,
              direction: place.direction,
              towards_danger: place.towardsDanger,
              // The first entry is the recommendation; the map highlights it.
              selected: index === 0,
              osm_id: place.id,
              source: OVERPASS_SOURCE_NAME,
            }),
          ),
        ),
      },
    ];
    if (avoidZones.length > 0) {
      layers.push({
        id: "avoid",
        kind: "radius",
        geojson: featureCollection(
          avoidZones.map((zone) => circleFeature(zone, zone.radiusKm, { label: "avoid" })),
        ),
      });
    }

    const result: SafetyToolResult = {
      summary: placesSummary(ranked, type, radiusKm, avoidZones.length),
      severity: "none",
      map: {
        view: ranked[0]
          ? { center: [ranked[0].lon, ranked[0].lat], zoom: 11 }
          : { center: [lon, lat], zoom: 10 },
        layers,
      },
      data: {
        count: ranked.length,
        radius_km: radiusKm,
        type,
        avoided_zones: avoidZones.length,
        places: ranked.map((place) => ({
          name: place.name,
          type: place.type,
          lat: place.lat,
          lon: place.lon,
          distance_km: Math.round(place.distanceKm * 10) / 10,
          bearing_deg: place.bearingDeg,
          direction: place.direction,
          towards_danger: place.towardsDanger,
        })),
      },
      sources: [
        { name: OVERPASS_SOURCE_NAME, url: OVERPASS_URL, fetchedAt: new Date().toISOString() },
      ],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

async function loadPlaces(
  point: LatLon,
  radiusKm: number,
  type: "hospital" | "fire_station" | "shelter" | "any",
): Promise<{ places: OsmPlace[]; demo: boolean }> {
  if (config.demoMode) {
    const recorded = await loadNearestJsonFixture<Parameters<typeof parseOverpassPlaces>[0]>(
      point,
      "places",
    );
    const places = recorded ? parseOverpassPlaces(recorded, point) : [];
    return {
      places: places.filter(
        (place) => place.distanceKm <= radiusKm && (type === "any" || place.type === type),
      ),
      demo: true,
    };
  }
  return { places: await fetchSafePlaces(point, radiusKm, type), demo: false };
}
