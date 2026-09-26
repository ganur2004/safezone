import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { destination } from "@safezone/shared";
import { parseFirmsCsv, firmsRequestUrl } from "../src/sources/firms.js";
import { clusterHotspots, fireSummary, filterHotspots } from "../src/tools/fires.js";

const sacramento = { lat: 38.5816, lon: -121.4944 };
const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, "../fixtures/fires", name), "utf8");

describe("parseFirmsCsv", () => {
  it("parses the recorded Sacramento feed", () => {
    const hotspots = parseFirmsCsv(fixture("sacramento-fires.csv"));
    expect(hotspots.length).toBe(15);
    const first = hotspots[0]!;
    expect(first.lat).toBeCloseTo(38.69, 1);
    expect(first.lon).toBeCloseTo(-121.37, 1);
    expect(first.frp).toBeGreaterThan(0);
    expect(first.acquiredAt).toMatch(/^2026-09-25T\d{2}:\d{2}:00Z$/);
  });

  it("returns an empty list for a header-only feed", () => {
    expect(parseFirmsCsv(fixture("calm.csv"))).toEqual([]);
  });
});

describe("firmsRequestUrl", () => {
  it("builds a bbox URL and clamps days to the allowed 1..10 range", () => {
    const url = firmsRequestUrl({ ...sacramento, radiusKm: 50, days: 99 }, "KEY");
    expect(url).toContain("/api/area/csv/KEY/VIIRS_SNPP_NRT/");
    expect(url.endsWith("/10")).toBe(true);
    const bbox = url.split("/").at(-2)!.split(",").map(Number);
    expect(bbox[0]).toBeLessThan(sacramento.lon);
    expect(bbox[3]).toBeGreaterThan(sacramento.lat);
  });
});

describe("filterHotspots", () => {
  const near = destination(sacramento, 45, 18);
  const far = destination(sacramento, 90, 80);

  const raw = [
    { lat: far.lat, lon: far.lon, confidence: "h", frp: 30, acquiredAt: "", satellite: "N" },
    { lat: near.lat, lon: near.lon, confidence: "n", frp: 10, acquiredAt: "", satellite: "N" },
    { lat: near.lat, lon: near.lon, confidence: "l", frp: 99, acquiredAt: "", satellite: "N" },
  ];

  it("drops low confidence detections and anything beyond the radius", () => {
    const filtered = filterHotspots(sacramento, raw, 50);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.distanceKm).toBeCloseTo(18, 1);
    expect(filtered[0]!.direction).toBe("NE");
  });

  it("sorts by distance, closest first", () => {
    const filtered = filterHotspots(sacramento, raw, 200);
    expect(filtered.map((hotspot) => Math.round(hotspot.distanceKm))).toEqual([18, 80]);
  });
});

describe("clusterHotspots", () => {
  it("groups the recorded Sacramento hotspots into distinct clusters", () => {
    const hotspots = filterHotspots(sacramento, parseFirmsCsv(fixture("sacramento-fires.csv")), 50);
    const clusters = clusterHotspots(sacramento, hotspots);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(clusters.length).toBeLessThan(hotspots.length);
    // Total count is preserved and clusters come back nearest first.
    expect(clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(hotspots.length);
    const distances = clusters.map((cluster) => cluster.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(clusters[0]!.direction).toBe("NE");
  });

  it("merges hotspots inside the cluster radius and splits those outside it", () => {
    const a = destination(sacramento, 45, 20);
    const b = destination(a, 90, 1.5); // within 2 km of a
    const c = destination(sacramento, 45, 40); // far away
    const hotspots = filterHotspots(
      sacramento,
      [a, b, c].map((point) => ({
        lat: point.lat,
        lon: point.lon,
        confidence: "n",
        frp: 5,
        acquiredAt: "",
        satellite: "N",
      })),
      50,
    );
    const clusters = clusterHotspots(sacramento, hotspots);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.count).toBe(2);
    expect(clusters[1]!.count).toBe(1);
  });
});

describe("fireSummary", () => {
  it("says nothing is burning when the list is empty", () => {
    expect(fireSummary([], [], 50, 1)).toMatch(/No active fire hotspots/);
  });

  it("reports count, both units and a spoken direction, in at most two sentences", () => {
    const hotspots = filterHotspots(sacramento, parseFirmsCsv(fixture("sacramento-fires.csv")), 50);
    const summary = fireSummary(hotspots, clusterHotspots(sacramento, hotspots), 50, 1);
    expect(summary).toContain("50 km (31 mi)");
    expect(summary).toMatch(/north-east\.$/);
    expect(summary.split(". ").length).toBeLessThanOrEqual(2);
    expect(summary).not.toMatch(/-?\d+\.\d{3}/); // no raw coordinates
  });
});
