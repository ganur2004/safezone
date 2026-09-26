import { describe, expect, it } from "vitest";
import { angleDiff, bearingDeg, destination, haversineKm } from "@safezone/shared";
import { parseWind } from "../src/sources/openMeteo.js";
import { describeWind, windArrow, windSummary, windToDeg } from "../src/tools/wind.js";

const sacramento = { lat: 38.5816, lon: -121.4944 };

describe("windToDeg", () => {
  it("turns 'comes from' into 'blows towards' (spec 6.2)", () => {
    expect(windToDeg(270)).toBe(90); // a west wind blows east
    expect(windToDeg(0)).toBe(180); // a north wind blows south
    expect(windToDeg(180)).toBe(0);
    expect(windToDeg(45)).toBe(225);
  });
});

describe("describeWind", () => {
  it("names both directions", () => {
    const wind = describeWind(20, 270, 30);
    expect(wind.fromDirection).toBe("W");
    expect(wind.toDirection).toBe("E");
    expect(wind.toDeg).toBe(90);
    expect(wind.gustsKmh).toBe(30);
  });
});

describe("windArrow", () => {
  it("points the arrow where the wind is going, not where it came from", () => {
    const wind = describeWind(20, 45, undefined); // from the north-east
    const [start, tip] = windArrow(sacramento, wind).geometry.coordinates as [
      [number, number],
      [number, number],
    ];
    expect(start).toEqual([sacramento.lon, sacramento.lat]);
    const heading = bearingDeg(sacramento, { lat: tip[1], lon: tip[0] });
    expect(angleDiff(heading, 225)).toBeLessThan(1); // towards the south-west
  });

  it("scales the arrow with the speed, within limits", () => {
    const length = (speed: number): number => {
      const arrow = windArrow(sacramento, describeWind(speed, 0, undefined));
      const [, tip] = arrow.geometry.coordinates as [[number, number], [number, number]];
      return haversineKm(sacramento, { lat: tip[1], lon: tip[0] });
    };
    expect(length(1)).toBeCloseTo(3, 0); // clamped low
    expect(length(20)).toBeCloseTo(12, 0);
    expect(length(200)).toBeCloseTo(30, 0); // clamped high
  });
});

describe("windSummary", () => {
  it("says so when there is no reading", () => {
    expect(windSummary(undefined)).toMatch(/temporarily unavailable/);
  });

  it("reports both units and both directions", () => {
    const summary = windSummary(describeWind(24, 270, 26));
    expect(summary).toContain("from the west");
    expect(summary).toContain("towards the east");
    expect(summary).toContain("24 km/h (15 mph)");
  });

  it("mentions gusts only when they are notably stronger", () => {
    expect(windSummary(describeWind(20, 90, 22))).not.toMatch(/Gusts/);
    expect(windSummary(describeWind(20, 90, 45))).toMatch(/Gusts reach 45 km\/h/);
  });

  it("handles a nearly calm reading", () => {
    expect(windSummary(describeWind(1, 350, 2))).toMatch(/nearly calm/);
  });
});

describe("parseWind on a recorded response", () => {
  it("keeps the meteorological 'from' direction untouched", () => {
    const reading = parseWind({
      current: {
        time: "2026-09-26T18:15",
        wind_speed_10m: 5.9,
        wind_direction_10m: 256,
        wind_gusts_10m: 6.5,
      },
    });
    expect(reading).toEqual({
      speedKmh: 5.9,
      gustsKmh: 6.5,
      fromDeg: 256,
      observedAt: "2026-09-26T18:15",
    });
    expect(windToDeg(reading.fromDeg!)).toBe(76);
  });

  it("survives a response with no current block", () => {
    expect(parseWind({})).toEqual({
      speedKmh: undefined,
      gustsKmh: undefined,
      fromDeg: undefined,
      observedAt: undefined,
    });
  });
});

describe("destination sanity check used by the arrow", () => {
  it("moves the expected distance", () => {
    expect(haversineKm(sacramento, destination(sacramento, 90, 12))).toBeCloseTo(12, 2);
  });
});
