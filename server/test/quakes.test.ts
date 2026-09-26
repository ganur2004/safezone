import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUsgsQuakes, usgsRequestUrl, type Quake } from "../src/sources/usgs.js";
import { quakeSeverity, quakesSummary } from "../src/tools/quakes.js";

const losAngeles = { lat: 34.0522, lon: -118.2437 };
const chicago = { lat: 41.8781, lon: -87.6298 };

const fixture = (name: string): Parameters<typeof parseUsgsQuakes>[0] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/quakes", name), "utf8"));

const laQuakes = parseUsgsQuakes(fixture("los-angeles.json"), losAngeles);

describe("parseUsgsQuakes", () => {
  it("reads the recorded Los Angeles catalogue, strongest first", () => {
    expect(laQuakes.length).toBeGreaterThan(0);
    const magnitudes = laQuakes.map((quake) => quake.magnitude);
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
    const first = laQuakes[0]!;
    expect(first.place).toBeTruthy();
    expect(first.distanceKm).toBeGreaterThan(0);
    expect(first.time).toBeGreaterThan(0);
  });

  it("reads an empty catalogue for a quiet region", () => {
    expect(parseUsgsQuakes(fixture("calm.json"), chicago)).toEqual([]);
  });

  it("skips features without a magnitude or coordinates", () => {
    const parsed = parseUsgsQuakes(
      {
        features: [
          { id: "a", geometry: { coordinates: [-118, 34, 5] }, properties: { mag: null } },
          { id: "b", geometry: null, properties: { mag: 4 } },
          { id: "c", geometry: { coordinates: [-118, 34, 5] }, properties: { mag: 4, time: 1 } },
        ],
      },
      losAngeles,
    );
    expect(parsed.map((quake) => quake.id)).toEqual(["c"]);
  });
});

describe("usgsRequestUrl", () => {
  it("asks for the requested window and radius", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    const url = usgsRequestUrl({ ...losAngeles, radiusKm: 200, days: 3, minMagnitude: 2.5 }, now);
    expect(url).toContain("maxradiuskm=200");
    expect(url).toContain("minmagnitude=2.5");
    expect(url).toContain("starttime=2026-09-23T12:00:00.000Z");
  });
});

describe("quakeSeverity (spec 6.1)", () => {
  const now = Date.UTC(2026, 8, 26, 12);
  const quake = (magnitude: number, distanceKm: number, hoursAgo: number): Quake => ({
    id: `m${magnitude}`,
    magnitude,
    place: "test",
    time: now - hoursAgo * 3600_000,
    depthKm: 10,
    lat: 0,
    lon: 0,
    url: "",
    distanceKm,
  });

  it("is none with no quakes", () => {
    expect(quakeSeverity([], now)).toBe("none");
  });

  it("is moderate for M5+ within 100 km in the last 24 hours", () => {
    expect(quakeSeverity([quake(5.2, 80, 6)], now)).toBe("moderate");
  });

  it("is high for M6+ within 100 km in the last 24 hours", () => {
    expect(quakeSeverity([quake(6.1, 50, 2)], now)).toBe("high");
  });

  it("ignores strong quakes that are too far away or too old", () => {
    expect(quakeSeverity([quake(6.5, 300, 2)], now)).toBe("low");
    expect(quakeSeverity([quake(6.5, 50, 48)], now)).toBe("low");
  });
});

describe("quakesSummary", () => {
  it("says nothing happened when the list is empty", () => {
    expect(quakesSummary([], 200, 3)).toMatch(/No earthquakes were recorded/);
  });

  it("reports the count, the strongest magnitude and both units", () => {
    const summary = quakesSummary(laQuakes, 200, 3);
    expect(summary).toContain("200 km (124 mi)");
    expect(summary).toMatch(/magnitude \d\.\d/);
    expect(summary.split(". ").length).toBeLessThanOrEqual(2);
  });
});
