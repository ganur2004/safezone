/**
 * Overpass API (OpenStreetMap) — hospitals, fire stations, shelters and
 * assembly points (spec 5.3 `find_safe_places`).
 *
 * Overpass rejects requests whose User-Agent contains an email in parentheses
 * with HTTP 406, and also rejects Node's default agent, so we send a plain token.
 */
import { haversineKm, type LatLon } from "@safezone/shared";
import { SourceUnavailableError } from "../lib/errors.js";
import { cacheKey, postForJson, withCache } from "../lib/http.js";

export const OVERPASS_SOURCE_NAME = "OpenStreetMap (Overpass API)";
export const OVERPASS_URL = "https://www.openstreetmap.org/copyright";
/**
 * Public Overpass instances are frequently busy and answer 504; we try them in
 * order. Each attempt is capped well below the 8s of the other sources, because
 * Overpass is genuinely slower and a voice answer still has to arrive.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_ATTEMPT_TIMEOUT_MS = 12000;
const OVERPASS_USER_AGENT = "SafeZone/0.1";

export type SafePlaceType = "hospital" | "fire_station" | "shelter" | "any";

/** OSM tag filters per place type. */
const TAG_FILTERS: Record<Exclude<SafePlaceType, "any">, string[]> = {
  hospital: ['["amenity"="hospital"]'],
  fire_station: ['["amenity"="fire_station"]'],
  shelter: ['["emergency"="assembly_point"]', '["social_facility"="shelter"]'],
};

export interface OsmPlace extends LatLon {
  id: string;
  name: string;
  type: Exclude<SafePlaceType, "any">;
  distanceKm: number;
}

export function buildOverpassQuery(
  point: LatLon,
  radiusKm: number,
  type: SafePlaceType,
  limit = 120,
): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${point.lat.toFixed(5)},${point.lon.toFixed(5)})`;
  const filters = type === "any" ? Object.values(TAG_FILTERS).flat() : TAG_FILTERS[type];
  // Hospitals are often mapped as ways; `out center` gives them a point.
  const clauses = filters
    .flatMap((filter) => [`node${filter}${around};`, `way${filter}${around};`])
    .join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout center tags ${limit};`;
}

interface OverpassResponse {
  elements?: {
    type?: string;
    id?: number;
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  }[];
}

function classify(tags: Record<string, string>): Exclude<SafePlaceType, "any"> | undefined {
  if (tags.amenity === "hospital") return "hospital";
  if (tags.amenity === "fire_station") return "fire_station";
  if (tags.emergency === "assembly_point" || tags.social_facility === "shelter") return "shelter";
  return undefined;
}

const TYPE_LABELS: Record<Exclude<SafePlaceType, "any">, string> = {
  hospital: "Hospital",
  fire_station: "Fire station",
  shelter: "Shelter",
};

export function parseOverpassPlaces(body: OverpassResponse, origin: LatLon): OsmPlace[] {
  return (body.elements ?? [])
    .flatMap((element) => {
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      const tags = element.tags ?? {};
      const type = classify(tags);
      if (lat === undefined || lon === undefined || !type) return [];
      return [
        {
          id: `${element.type ?? "node"}/${element.id ?? 0}`,
          // Unnamed features are common in OSM; a type label still helps the map.
          name: tags.name ?? tags["operator"] ?? `Unnamed ${TYPE_LABELS[type].toLowerCase()}`,
          type,
          lat,
          lon,
          distanceKm: haversineKm(origin, { lat, lon }),
        },
      ];
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export async function fetchSafePlaces(
  point: LatLon,
  radiusKm: number,
  type: SafePlaceType,
): Promise<OsmPlace[]> {
  const key = cacheKey("overpass", { lat: point.lat, lon: point.lon, radiusKm, type });
  return withCache(key, async () => {
    const body = new URLSearchParams({ data: buildOverpassQuery(point, radiusKm, type) });
    let lastError: unknown;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await postForJson<OverpassResponse>(endpoint, body, {
          sourceName: OVERPASS_SOURCE_NAME,
          headers: { "user-agent": OVERPASS_USER_AGENT },
          timeoutMs: OVERPASS_ATTEMPT_TIMEOUT_MS,
        });
        return parseOverpassPlaces(response, point);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new SourceUnavailableError(OVERPASS_SOURCE_NAME, "place search is unavailable");
  });
}
