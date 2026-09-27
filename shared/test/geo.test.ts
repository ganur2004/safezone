import { describe, expect, it } from "vitest";
import {
  angleDiff,
  bboxAround,
  bearingDeg,
  destination,
  distanceProperties,
  formatKmAndMiles,
  haversineKm,
  toCardinal,
} from "../src/geo.js";

const sacramento = { lat: 38.5816, lon: -121.4944 };

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(sacramento, sacramento)).toBe(0);
  });

  it("matches a known distance (Sacramento to San Francisco ~ 120 km)", () => {
    const sanFrancisco = { lat: 37.7749, lon: -122.4194 };
    expect(haversineKm(sacramento, sanFrancisco)).toBeCloseTo(120.8, 1);
  });
});

describe("bearingDeg + toCardinal", () => {
  it("reports north for a point straight up", () => {
    expect(bearingDeg(sacramento, { lat: 39.5, lon: -121.4944 })).toBeCloseTo(0, 5);
    expect(toCardinal(0)).toBe("N");
  });

  it("reports east for a point to the right", () => {
    const east = bearingDeg(sacramento, { lat: 38.5816, lon: -120.4 });
    expect(east).toBeGreaterThan(85);
    expect(east).toBeLessThan(95);
    expect(toCardinal(east)).toBe("E");
  });

  it("maps 45 degrees to NE and 315 to NW", () => {
    expect(toCardinal(45)).toBe("NE");
    expect(toCardinal(315)).toBe("NW");
    expect(toCardinal(-45)).toBe("NW");
  });
});

describe("destination", () => {
  it("round-trips with haversineKm and bearingDeg", () => {
    const target = destination(sacramento, 45, 18);
    expect(haversineKm(sacramento, target)).toBeCloseTo(18, 3);
    expect(bearingDeg(sacramento, target)).toBeCloseTo(45, 1);
  });
});

describe("bboxAround", () => {
  it("covers the requested radius in every direction", () => {
    const [west, , east, north] = bboxAround(sacramento, 50);
    expect(west).toBeLessThan(sacramento.lon);
    expect(east).toBeGreaterThan(sacramento.lon);
    expect(haversineKm(sacramento, { lat: north, lon: sacramento.lon })).toBeCloseTo(50, 0);
    expect(haversineKm(sacramento, { lat: sacramento.lat, lon: east })).toBeGreaterThanOrEqual(49);
  });
});

describe("angleDiff", () => {
  it("wraps around 360", () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
  });
});

describe("formatKmAndMiles", () => {
  it("gives both units, as the judges are in the US", () => {
    expect(formatKmAndMiles(18)).toBe("18 km (11 mi)");
    expect(formatKmAndMiles(0.42)).toBe("0.4 km (0.3 mi)");
  });
});

describe("distanceProperties", () => {
  it("rounds both units from the same source value, so a popup cannot disagree", () => {
    // 2.4853 km is 1.544 mi: rounding the kilometres first would give 1.6.
    expect(distanceProperties(2.4853)).toEqual({ distance_km: 2.5, distance_mi: 1.5 });
    expect(distanceProperties(18)).toEqual({ distance_km: 18, distance_mi: 11 });
  });
});
