/**
 * Routing for `get_route` (SPEC 5.3).
 *
 * Amazon Location Routes when a key is configured — it is the AWS service we
 * want to show off — and the keyless OSRM demo server otherwise, so the route
 * works in the demo with no account at all. Same pattern as geocoding.
 */
import { CalculateRoutesCommand, GeoRoutesClient } from "@aws-sdk/client-geo-routes";
import type { LatLon } from "@safezone/shared";
import { config } from "../config.js";
import { SourceUnavailableError } from "../lib/errors.js";
import { cacheKey, fetchJson, withCache } from "../lib/http.js";

export const AMAZON_ROUTES_SOURCE = "Amazon Location Service (Routes)";
export const AMAZON_ROUTES_URL = "https://aws.amazon.com/location/";
export const OSRM_SOURCE = "OSRM (OpenStreetMap)";
export const OSRM_URL = "https://project-osrm.org/";

export interface Route {
  distanceKm: number;
  durationMin: number;
  /** [lon, lat] pairs, ready for a GeoJSON LineString. */
  coordinates: [number, number][];
  source: { name: string; url: string };
}

let client: GeoRoutesClient | undefined;

export const isAmazonRoutingConfigured = (): boolean => config.amazonLocationApiKey !== undefined;

export async function calculateRoute(from: LatLon, to: LatLon): Promise<Route> {
  const key = cacheKey("route", {
    fromLat: from.lat.toFixed(4),
    fromLon: from.lon.toFixed(4),
    toLat: to.lat.toFixed(4),
    toLon: to.lon.toFixed(4),
    provider: isAmazonRoutingConfigured() ? "amazon" : "osrm",
  });
  return withCache(key, async () =>
    isAmazonRoutingConfigured() ? routeWithAmazon(from, to) : routeWithOsrm(from, to),
  );
}

async function routeWithAmazon(from: LatLon, to: LatLon): Promise<Route> {
  const apiKey = config.amazonLocationApiKey;
  if (!apiKey) {
    throw new SourceUnavailableError(AMAZON_ROUTES_SOURCE, "routing is not configured", {
      retryable: false,
    });
  }
  client ??= new GeoRoutesClient({ region: config.awsRegion });
  try {
    const response = await client.send(
      new CalculateRoutesCommand({
        // Amazon Location takes positions as [longitude, latitude].
        Origin: [from.lon, from.lat],
        Destination: [to.lon, to.lat],
        TravelMode: "Car",
        LegGeometryFormat: "Simple",
        Key: apiKey,
      }),
    );
    const route = response.Routes?.[0];
    const summary = route?.Summary;
    const coordinates = (route?.Legs ?? []).flatMap(
      (leg) => (leg.Geometry?.LineString ?? []) as [number, number][],
    );
    if (!summary || coordinates.length === 0) {
      throw new SourceUnavailableError(AMAZON_ROUTES_SOURCE, "no route was found");
    }
    return {
      distanceKm: (summary.Distance ?? 0) / 1000,
      durationMin: (summary.Duration ?? 0) / 60,
      coordinates,
      source: { name: AMAZON_ROUTES_SOURCE, url: AMAZON_ROUTES_URL },
    };
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    throw new SourceUnavailableError(AMAZON_ROUTES_SOURCE, "routing is unavailable", {
      cause: error,
    });
  }
}

interface OsrmResponse {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }[];
}

export function parseOsrmRoute(body: OsrmResponse): Route | undefined {
  const route = body.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (body.code !== "Ok" || !route || !coordinates || coordinates.length === 0) return undefined;
  return {
    distanceKm: (route.distance ?? 0) / 1000,
    durationMin: (route.duration ?? 0) / 60,
    coordinates,
    source: { name: OSRM_SOURCE, url: OSRM_URL },
  };
}

async function routeWithOsrm(from: LatLon, to: LatLon): Promise<Route> {
  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    "?overview=full&geometries=geojson";
  const parsed = parseOsrmRoute(await fetchJson<OsrmResponse>(url, { sourceName: OSRM_SOURCE }));
  if (!parsed) throw new SourceUnavailableError(OSRM_SOURCE, "no route was found");
  return parsed;
}
