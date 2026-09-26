/**
 * Contract tests (spec 13): every tool answers with a valid SafetyToolResult in
 * DEMO_MODE, so the whole tool surface is covered without any API keys.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { safetyToolResultSchema, type SafetyToolResult } from "@safezone/shared";
import type { findSafePlacesTool } from "../src/tools/findSafePlaces.js";
import type { geocodeTool } from "../src/tools/geocode.js";
import type { getAirQualityTool } from "../src/tools/getAirQuality.js";
import type { getEarthquakesTool } from "../src/tools/getEarthquakes.js";
import type { getWeatherAlertsTool } from "../src/tools/getWeatherAlerts.js";
import type { getWindTool } from "../src/tools/getWind.js";

process.env.DEMO_MODE = "true";

const sacramento = { lat: 38.5816, lon: -121.4944 };
const hilo = { lat: 19.707, lon: -155.0885 };
const chicago = { lat: 41.8781, lon: -87.6298 };

let geocode: typeof geocodeTool;
let alerts: typeof getWeatherAlertsTool;
let quakes: typeof getEarthquakesTool;
let air: typeof getAirQualityTool;
let wind: typeof getWindTool;
let places: typeof findSafePlacesTool;

beforeAll(async () => {
  ({ geocodeTool: geocode } = await import("../src/tools/geocode.js"));
  ({ getWeatherAlertsTool: alerts } = await import("../src/tools/getWeatherAlerts.js"));
  ({ getEarthquakesTool: quakes } = await import("../src/tools/getEarthquakes.js"));
  ({ getAirQualityTool: air } = await import("../src/tools/getAirQuality.js"));
  ({ getWindTool: wind } = await import("../src/tools/getWind.js"));
  ({ findSafePlacesTool: places } = await import("../src/tools/findSafePlaces.js"));
});

/** Every result must satisfy the shared schema and the spoken-summary rules. */
function expectValid(result: SafetyToolResult): void {
  expect(safetyToolResultSchema.parse(result)).toBeTruthy();
  expect(result.demo).toBe(true);
  expect(result.sources.length).toBeGreaterThan(0);
  // Max two sentences, no raw coordinates (spec 5.2).
  expect(result.summary.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);
  expect(result.summary).not.toMatch(/-?\d+\.\d{3,}/);
  for (const layer of result.map?.layers ?? []) {
    expect(layer.geojson.type).toBe("FeatureCollection");
  }
}

describe("geocode", () => {
  it("resolves a place name from the recorded scenarios", async () => {
    const result = await geocode.handler({ query: "Sacramento" });
    expectValid(result);
    expect(result.data.name).toBe("Sacramento");
    expect(result.map?.layers[0]?.kind).toBe("home");
    expect(result.map?.view?.center?.[1]).toBeCloseTo(sacramento.lat, 1);
  });

  it("matches a place mentioned inside a sentence", async () => {
    const result = await geocode.handler({ query: "my home in Sacramento" });
    expect(result.data.name).toBe("Sacramento");
  });

  it("rejects an empty query", async () => {
    await expect(geocode.handler({ query: " " })).rejects.toThrow(/which place/i);
  });
});

describe("get_weather_alerts", () => {
  it("returns alert polygons for the recorded Hawaii storm", async () => {
    const result = await alerts.handler(hilo);
    expectValid(result);
    expect(Number(result.data.count)).toBeGreaterThan(0);
    expect(result.severity).toBe("high");
    const layer = result.map?.layers.find((entry) => entry.id === "alerts");
    expect(layer?.geojson.features.length).toBeGreaterThan(0);
  });

  it("returns no alerts and no layer for a calm location", async () => {
    const result = await alerts.handler(chicago);
    expectValid(result);
    expect(result.data.count).toBe(0);
    expect(result.severity).toBe("none");
    expect(result.map?.layers).toEqual([]);
  });
});

describe("get_earthquakes", () => {
  it("returns recent quakes with a strongest entry", async () => {
    const result = await quakes.handler({
      ...sacramento,
      radius_km: 200,
      days: 3,
      min_magnitude: 2.5,
    });
    expectValid(result);
    expect(result.map?.layers[0]?.kind).toBe("quakes");
    const strongest = result.data.strongest as { magnitude: number } | null;
    if (Number(result.data.count) > 0) {
      expect(strongest?.magnitude).toBeGreaterThanOrEqual(2.5);
    } else {
      expect(strongest).toBeNull();
    }
  });

  it("honours the magnitude filter", async () => {
    const result = await quakes.handler({
      ...sacramento,
      radius_km: 200,
      days: 3,
      min_magnitude: 9,
    });
    expect(result.data.count).toBe(0);
    expect(result.summary).toMatch(/No earthquakes/);
  });
});

describe("get_air_quality", () => {
  it("returns an AQI, a category and a coloured point", async () => {
    const result = await air.handler(sacramento);
    expectValid(result);
    expect(typeof result.data.us_aqi).toBe("number");
    expect(result.data.category).toBeTruthy();
    expect(String(result.data.color)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.map?.layers[0]?.kind).toBe("air");
  });
});

describe("get_wind", () => {
  it("reports both from_deg and to_deg, 180 degrees apart (spec 6.2)", async () => {
    const result = await wind.handler(sacramento);
    expectValid(result);
    const from = Number(result.data.from_deg);
    const to = Number(result.data.to_deg);
    expect((from + 180) % 360).toBe(to);
    expect(result.map?.layers[0]?.kind).toBe("wind");
    expect(result.map?.layers[0]?.geojson.features[0]?.geometry?.type).toBe("LineString");
  });
});

describe("find_safe_places", () => {
  it("returns up to five ranked places", async () => {
    const result = await places.handler({
      ...sacramento,
      type: "any",
      radius_km: 25,
      avoid: undefined,
    });
    expectValid(result);
    const found = result.data.places as { distance_km: number }[];
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(5);
    expect(result.map?.layers[0]?.geojson.features[0]?.properties?.selected).toBe(true);
  });

  it("filters by type", async () => {
    const result = await places.handler({
      ...sacramento,
      type: "hospital",
      radius_km: 25,
      avoid: undefined,
    });
    const found = result.data.places as { type: string }[];
    expect(found.every((place) => place.type === "hospital")).toBe(true);
  });

  it("avoids a hazard zone and draws it on the map", async () => {
    const withoutAvoid = await places.handler({
      ...sacramento,
      type: "hospital",
      radius_km: 25,
      avoid: undefined,
    });
    const nearestUnfiltered = (withoutAvoid.data.places as { lat: number; lon: number }[])[0];
    const result = await places.handler({
      ...sacramento,
      type: "hospital",
      radius_km: 25,
      avoid: [{ lat: nearestUnfiltered!.lat, lon: nearestUnfiltered!.lon, radius_km: 3 }],
    });
    const found = result.data.places as { lat: number }[];
    expect(found.some((place) => place.lat === nearestUnfiltered!.lat)).toBe(false);
    expect(result.data.avoided_zones).toBe(1);
    expect(result.map?.layers.some((layer) => layer.id === "avoid")).toBe(true);
    expect(result.summary).toContain("away from the hazard");
  });
});
