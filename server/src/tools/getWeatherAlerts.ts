/** MCP tool `get_weather_alerts` — official NWS warnings for a point (spec 5.3). */
import { z } from "zod";
import type { LatLon, MapLayer, SafetyToolResult } from "@safezone/shared";
import type { Feature } from "geojson";
import { config } from "../config.js";
import { featureCollection } from "../lib/geojson.js";
import {
  NWS_SOURCE_NAME,
  NWS_URL,
  fetchNwsAlerts,
  parseNwsAlerts,
  type NwsAlert,
  type NwsAlertsResult,
} from "../sources/nws.js";
import { loadNearestJsonFixture } from "../demo/fixtures.js";
import {
  alertsSummary,
  firstInstruction,
  mapNwsSeverity,
  sortBySeverity,
  worstSeverity,
} from "./alerts.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude of the place to check."),
  lon: z.number().min(-180).max(180).describe("Longitude of the place to check."),
};

export const getWeatherAlertsTool = defineTool({
  name: "get_weather_alerts",
  title: "Official weather alerts",
  description:
    "Returns official US National Weather Service alerts in effect at a location: storms, floods, " +
    "heat, high wind and Red Flag fire-weather warnings. Use for follow-up questions about " +
    "warnings, watches or official instructions. US locations only.",
  inputSchema,
  async handler({ lat, lon }): Promise<SafetyToolResult> {
    const point: LatLon = { lat, lon };
    const { result: alertsResult, demo } = await loadAlerts(point);
    const { alerts, covered } = alertsResult;
    const sorted = sortBySeverity(alerts);

    const polygons: Feature[] = sorted.flatMap((alert) =>
      // Zone-based alerts have no geometry: keep them in `data`, skip the map (spec 5.3).
      alert.geometry
        ? [
            {
              type: "Feature" as const,
              geometry: alert.geometry,
              properties: {
                event: alert.event,
                severity: mapNwsSeverity(alert.severity),
                nws_severity: alert.severity,
                headline: alert.headline,
                area: alert.areaDesc,
                expires: alert.expires,
                source: NWS_SOURCE_NAME,
              },
            },
          ]
        : [],
    );

    const layers: MapLayer[] =
      polygons.length > 0
        ? [{ id: "alerts", kind: "alerts", geojson: featureCollection(polygons) }]
        : [];

    const instruction = firstInstruction(alerts);
    const result: SafetyToolResult = {
      summary: alertsSummary(alerts, covered),
      severity: worstSeverity(alerts),
      map: { view: { center: [lon, lat], zoom: 8 }, layers },
      data: {
        covered_by_nws: covered,
        count: alerts.length,
        alerts: sorted.map(describeAlert),
        recommendations: instruction ? [`Follow official instructions: ${instruction}`] : [],
      },
      sources: [{ name: NWS_SOURCE_NAME, url: NWS_URL, fetchedAt: new Date().toISOString() }],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

const describeAlert = (alert: NwsAlert) => ({
  event: alert.event,
  severity: mapNwsSeverity(alert.severity),
  nws_severity: alert.severity,
  urgency: alert.urgency,
  certainty: alert.certainty,
  headline: alert.headline,
  instruction: alert.instruction,
  area: alert.areaDesc,
  effective: alert.effective,
  expires: alert.expires,
  has_geometry: alert.geometry !== null,
});

async function loadAlerts(point: LatLon): Promise<{ result: NwsAlertsResult; demo: boolean }> {
  if (config.demoMode) {
    const recorded = await loadNearestJsonFixture<Parameters<typeof parseNwsAlerts>[0]>(
      point,
      "alerts",
    );
    return {
      result: { alerts: recorded ? parseNwsAlerts(recorded) : [], covered: true },
      demo: true,
    };
  }
  return { result: await fetchNwsAlerts(point), demo: false };
}
