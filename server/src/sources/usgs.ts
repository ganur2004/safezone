/** USGS earthquake catalogue (spec 5.3 `get_earthquakes`). No key, already GeoJSON. */
import { haversineKm, type LatLon } from "@safezone/shared";
import { cacheKey, fetchJson, withCache } from "../lib/http.js";

export const USGS_SOURCE_NAME = "USGS Earthquake Hazards Program";
export const USGS_URL = "https://earthquake.usgs.gov/earthquakes/map/";

export interface Quake extends LatLon {
  id: string;
  magnitude: number;
  place: string;
  /** Epoch milliseconds, as USGS reports it. */
  time: number;
  depthKm: number;
  url: string;
  distanceKm: number;
}

interface UsgsResponse {
  features?: {
    id?: string;
    geometry?: { coordinates?: number[] } | null;
    properties?: { mag?: number | null; place?: string; time?: number; url?: string };
  }[];
}

export function parseUsgsQuakes(body: UsgsResponse, origin: LatLon): Quake[] {
  return (body.features ?? [])
    .flatMap((feature) => {
      const [lon, lat, depth] = feature.geometry?.coordinates ?? [];
      const magnitude = feature.properties?.mag;
      if (lon === undefined || lat === undefined || magnitude === null || magnitude === undefined) {
        return [];
      }
      return [
        {
          id: feature.id ?? "",
          lat,
          lon,
          magnitude,
          place: feature.properties?.place ?? "",
          time: feature.properties?.time ?? 0,
          depthKm: depth ?? 0,
          url: feature.properties?.url ?? "",
          distanceKm: haversineKm(origin, { lat, lon }),
        },
      ];
    })
    .sort((a, b) => b.magnitude - a.magnitude);
}

export interface QuakeQuery extends LatLon {
  radiusKm: number;
  days: number;
  minMagnitude: number;
}

export function usgsRequestUrl(query: QuakeQuery, now = new Date()): string {
  const start = new Date(now.getTime() - query.days * 24 * 60 * 60 * 1000).toISOString();
  return (
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&latitude=${query.lat}&longitude=${query.lon}&maxradiuskm=${query.radiusKm}` +
    `&starttime=${start}&minmagnitude=${query.minMagnitude}&orderby=time`
  );
}

export async function fetchQuakes(query: QuakeQuery): Promise<Quake[]> {
  const key = cacheKey("usgs-quakes", {
    lat: query.lat,
    lon: query.lon,
    radiusKm: query.radiusKm,
    days: query.days,
    minMagnitude: query.minMagnitude,
  });
  return withCache(key, async () =>
    parseUsgsQuakes(
      await fetchJson<UsgsResponse>(usgsRequestUrl(query), { sourceName: USGS_SOURCE_NAME }),
      query,
    ),
  );
}
