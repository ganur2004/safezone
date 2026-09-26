/**
 * National Weather Service active alerts (spec 5.3 `get_weather_alerts`).
 * No key, but a User-Agent with a contact is required. US coverage only:
 * outside it the API answers 400 "out of bounds", which we report as
 * "US locations only" rather than as a failure.
 */
import type { LatLon } from "@safezone/shared";
import type { Geometry } from "geojson";
import { config } from "../config.js";
import { cacheKey, fetchJsonWithStatus, withCache } from "../lib/http.js";

export const NWS_SOURCE_NAME = "NOAA / National Weather Service";
export const NWS_URL = "https://www.weather.gov/";

/** As reported by NWS; `null` geometry means the alert is tied to zones, not a polygon. */
export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  certainty: string;
  urgency: string;
  headline: string;
  description: string;
  instruction: string;
  areaDesc: string;
  effective: string;
  expires: string;
  geometry: Geometry | null;
}

interface NwsResponse {
  features?: {
    id?: string;
    geometry?: Geometry | null;
    properties?: Record<string, unknown>;
  }[];
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export function parseNwsAlerts(body: NwsResponse): NwsAlert[] {
  return (body.features ?? []).map((feature) => {
    const properties = feature.properties ?? {};
    return {
      id: asString(properties.id) || asString(feature.id),
      event: asString(properties.event),
      severity: asString(properties.severity),
      certainty: asString(properties.certainty),
      urgency: asString(properties.urgency),
      headline: asString(properties.headline),
      description: asString(properties.description),
      instruction: asString(properties.instruction),
      areaDesc: asString(properties.areaDesc),
      effective: asString(properties.effective),
      expires: asString(properties.expires),
      geometry: feature.geometry ?? null,
    };
  });
}

export interface NwsAlertsResult {
  alerts: NwsAlert[];
  /** false when the point lies outside the NWS coverage area. */
  covered: boolean;
}

export async function fetchNwsAlerts(point: LatLon): Promise<NwsAlertsResult> {
  const url =
    "https://api.weather.gov/alerts/active" +
    `?point=${point.lat.toFixed(4)},${point.lon.toFixed(4)}&status=actual`;
  return withCache(cacheKey("nws-alerts", { ...point }), async () => {
    const { status, data } = await fetchJsonWithStatus<NwsResponse>(url, {
      sourceName: NWS_SOURCE_NAME,
      // NWS asks for a contact address in the User-Agent.
      headers: { "user-agent": config.nwsUserAgent, accept: "application/geo+json" },
      acceptStatuses: [400, 404],
    });
    if (status !== 200) return { alerts: [], covered: false };
    return { alerts: parseNwsAlerts(data), covered: true };
  });
}
