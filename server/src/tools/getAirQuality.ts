/** MCP tool `get_air_quality` — US AQI and particulates for a point (spec 5.3). */
import { z } from "zod";
import type { LatLon, SafetyToolResult } from "@safezone/shared";
import { config } from "../config.js";
import { featureCollection, pointFeature } from "../lib/geojson.js";
import {
  OPEN_METEO_AIR_SOURCE,
  fetchAirQuality,
  openMeteoSource,
  parseAirQuality,
  type AirQualityReading,
} from "../sources/openMeteo.js";
import { loadNearestJsonFixture } from "../demo/fixtures.js";
import { airQualitySummary, aqiBand } from "./aqi.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("Latitude of the place to check."),
  lon: z.number().min(-180).max(180).describe("Longitude of the place to check."),
};

export const getAirQualityTool = defineTool({
  name: "get_air_quality",
  title: "Air quality",
  description:
    "Returns the current US AQI, its EPA category and PM2.5 for a location. Use for follow-up " +
    "questions about air quality, smoke, haze or whether it is safe to be outside or open windows.",
  inputSchema,
  async handler({ lat, lon }): Promise<SafetyToolResult> {
    const point: LatLon = { lat, lon };
    const { reading, demo } = await loadAirQuality(point);
    const band = reading.usAqi === undefined ? undefined : aqiBand(reading.usAqi);

    const result: SafetyToolResult = {
      summary: airQualitySummary(reading.usAqi, band),
      severity: band?.severity ?? "none",
      map: {
        view: { center: [lon, lat], zoom: 9 },
        layers: [
          {
            id: "air",
            kind: "air",
            geojson: featureCollection([
              pointFeature(point, {
                us_aqi: reading.usAqi ?? null,
                category: band?.category ?? null,
                color: band?.color ?? null,
                pm2_5: reading.pm2_5 ?? null,
                pm10: reading.pm10 ?? null,
                observed_at: reading.observedAt ?? null,
                source: OPEN_METEO_AIR_SOURCE,
              }),
            ]),
          },
        ],
      },
      data: {
        us_aqi: reading.usAqi ?? null,
        category: band?.category ?? null,
        color: band?.color ?? null,
        pm2_5: reading.pm2_5 ?? null,
        pm10: reading.pm10 ?? null,
        observed_at: reading.observedAt ?? null,
      },
      sources: [openMeteoSource(OPEN_METEO_AIR_SOURCE)],
    };
    return demo ? { ...result, demo: true } : result;
  },
});

async function loadAirQuality(
  point: LatLon,
): Promise<{ reading: AirQualityReading; demo: boolean }> {
  if (config.demoMode) {
    const recorded = await loadNearestJsonFixture<Parameters<typeof parseAirQuality>[0]>(
      point,
      "air",
    );
    return {
      reading: recorded
        ? parseAirQuality(recorded)
        : { usAqi: undefined, pm2_5: undefined, pm10: undefined, observedAt: undefined },
      demo: true,
    };
  }
  return { reading: await fetchAirQuality(point), demo: false };
}
