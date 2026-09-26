/**
 * MCP tool `get_wind` — current wind for a point (spec 5.3).
 * Reports both where the wind comes FROM and where it blows TO, because the
 * meteorological convention is the easiest thing to get backwards (spec 6.2).
 */
import { z } from "zod";
import type { LatLon, SafetyToolResult } from "@safezone/shared";
import { config } from "../config.js";
import { featureCollection } from "../lib/geojson.js";
import {
  OPEN_METEO_WEATHER_SOURCE,
  fetchWind,
  openMeteoSource,
  parseWind,
  type WindReading,
} from "../sources/openMeteo.js";
import { loadNearestJsonFixture } from "../demo/fixtures.js";
import { describeWind, windArrow, windSummary } from "./wind.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude of the place to check."),
  lon: z.number().min(-180).max(180).describe("Longitude of the place to check."),
};

export const getWindTool = defineTool({
  name: "get_wind",
  title: "Current wind",
  description:
    "Returns the current wind speed, gusts and direction for a location, including which way the " +
    "wind is blowing towards. Use for follow-up questions about wind, or about where smoke or a " +
    "fire is likely to move.",
  inputSchema,
  async handler({ lat, lon }): Promise<SafetyToolResult> {
    const point: LatLon = { lat, lon };
    const { reading, demo } = await loadWind(point);
    const wind =
      reading.speedKmh === undefined || reading.fromDeg === undefined
        ? undefined
        : describeWind(reading.speedKmh, reading.fromDeg, reading.gustsKmh);

    const result: SafetyToolResult = {
      summary: windSummary(wind),
      severity: wind && wind.speedKmh >= 40 ? "moderate" : "none",
      map: {
        view: { center: [lon, lat], zoom: 9 },
        layers: wind
          ? [{ id: "wind", kind: "wind", geojson: featureCollection([windArrow(point, wind)]) }]
          : [],
      },
      data: {
        speed_kmh: wind?.speedKmh ?? null,
        gusts_kmh: wind?.gustsKmh ?? null,
        // from_deg: where the wind comes from. to_deg: where it is blowing.
        from_deg: wind?.fromDeg ?? null,
        to_deg: wind?.toDeg ?? null,
        from_direction: wind?.fromDirection ?? null,
        to_direction: wind?.toDirection ?? null,
        observed_at: reading.observedAt ?? null,
      },
      sources: [openMeteoSource(OPEN_METEO_WEATHER_SOURCE)],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

async function loadWind(point: LatLon): Promise<{ reading: WindReading; demo: boolean }> {
  if (config.demoMode) {
    const recorded = await loadNearestJsonFixture<Parameters<typeof parseWind>[0]>(point, "wind");
    return {
      reading: recorded
        ? parseWind(recorded)
        : { speedKmh: undefined, gustsKmh: undefined, fromDeg: undefined, observedAt: undefined },
      demo: true,
    };
  }
  return { reading: await fetchWind(point), demo: false };
}
