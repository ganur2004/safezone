import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { withArrowHeads } from "../src/map/arrow.js";

const line = (coordinates: [number, number][]): FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: { to_direction: "E" },
    },
  ],
});

describe("withArrowHeads", () => {
  it("adds one triangle at the end of the line", () => {
    const result = withArrowHeads(
      line([
        [-121.49, 38.58],
        [-121.35, 38.58],
      ]),
    );
    expect(result.features).toHaveLength(2);
    const head = result.features[1]!;
    expect(head.geometry.type).toBe("Polygon");
    expect(head.properties?.arrowhead).toBe(true);
    // The properties of the shaft carry over, so the popup works on either part.
    expect(head.properties?.to_direction).toBe("E");
    const ring = (head.geometry as { coordinates: [number, number][][] }).coordinates[0]!;
    expect(ring).toHaveLength(4); // tip, two barbs, back to the tip
    expect(ring[0]).toEqual(ring[3]);
  });

  it("puts the tip at the end of the line, not the start", () => {
    const start: [number, number] = [-121.49, 38.58];
    const end: [number, number] = [-121.35, 38.58];
    const result = withArrowHeads(line([start, end]));
    const ring = (result.features[1]!.geometry as { coordinates: [number, number][][] })
      .coordinates[0]!;
    expect(ring[0]).toEqual(end);
    // Both barbs trail behind the tip.
    expect(ring[1]![0]).toBeLessThan(end[0]);
    expect(ring[2]![0]).toBeLessThan(end[0]);
  });

  it("keeps the head proportional to the shaft, at every zoom", () => {
    const head = (lon: number): number => {
      const result = withArrowHeads(
        line([
          [-121.49, 38.58],
          [lon, 38.58],
        ]),
      );
      const ring = (result.features[1]!.geometry as { coordinates: [number, number][][] })
        .coordinates[0]!;
      // Width of the head in degrees of longitude, as drawn.
      return Math.abs(ring[1]![0] - ring[0]![0]);
    };
    const short = head(-121.46); // ~2.6 km shaft
    const long = head(-121.2); // ~25 km shaft
    // A long arrow gets a bigger head, but the head never runs away with the map.
    expect(long).toBeGreaterThan(short);
    expect(short / 0.03).toBeLessThan(0.2);
    expect(long).toBeLessThan(0.03);
  });

  it("leaves collections without a line untouched", () => {
    const points: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
      ],
    };
    expect(withArrowHeads(points)).toBe(points);
    expect(withArrowHeads({ type: "FeatureCollection", features: [] }).features).toHaveLength(0);
  });
});
