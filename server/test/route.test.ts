/** `get_route` (SPEC 5.3, P2): parsing, and the tool's own contract. */
import { beforeAll, describe, expect, it } from "vitest";
import { safetyToolResultSchema } from "@safezone/shared";
import type { parseOsrmRoute as ParseOsrmRoute } from "../src/sources/routing.js";
import type { getRouteTool } from "../src/tools/getRoute.js";

// The server reads its config when the module is first imported, and static
// imports are hoisted above this line — so everything here is imported lazily
// in beforeAll. Without that the tool would quietly call the real router.
process.env.DEMO_MODE = "true";

const sacramento = { lat: 38.5816, lon: -121.4944 };
const hospital = { lat: 38.5729, lon: -121.461 };

let handler: typeof getRouteTool.handler;
let parseOsrmRoute: typeof ParseOsrmRoute;

beforeAll(async () => {
  ({
    getRouteTool: { handler },
  } = await import("../src/tools/getRoute.js"));
  ({ parseOsrmRoute } = await import("../src/sources/routing.js"));
});

describe("parseOsrmRoute", () => {
  it("converts metres and seconds into the units the tool reports", () => {
    const route = parseOsrmRoute({
      code: "Ok",
      routes: [
        {
          distance: 3047,
          duration: 341,
          geometry: {
            coordinates: [
              [-121.49, 38.58],
              [-121.46, 38.57],
            ],
          },
        },
      ],
    });
    expect(route?.distanceKm).toBeCloseTo(3.047, 3);
    expect(route?.durationMin).toBeCloseTo(5.68, 2);
    expect(route?.coordinates).toHaveLength(2);
  });

  it("returns nothing when no route was found", () => {
    expect(parseOsrmRoute({ code: "NoRoute", routes: [] })).toBeUndefined();
    expect(parseOsrmRoute({ code: "Ok", routes: [] })).toBeUndefined();
    expect(parseOsrmRoute({})).toBeUndefined();
  });
});

describe("get_route", () => {
  it("returns a valid result with a route line and a destination marker", async () => {
    const result = await handler({
      from: sacramento,
      to: hospital,
      label: "Sutter Medical Center",
    });
    expect(safetyToolResultSchema.parse(result)).toBeTruthy();
    const route = result.map?.layers.find((layer) => layer.kind === "route");
    expect(route?.geojson.features[0]?.geometry?.type).toBe("LineString");
    expect(result.map?.layers.some((layer) => layer.id === "route-ends")).toBe(true);
    expect(result.severity).toBe("none");
  });

  it("speaks the distance in both units and the driving time", async () => {
    const result = await handler({
      from: sacramento,
      to: hospital,
      label: "Sutter Medical Center",
    });
    expect(result.summary).toMatch(
      /Sutter Medical Center is \d+(\.\d)? km \(\d+(\.\d)? mi\) by road/,
    );
    expect(result.summary).toMatch(/about \d+ minutes/);
    expect(Number(result.data.duration_min)).toBeGreaterThan(0);
  });

  it("is honest that a demo route is a straight line, not a road", async () => {
    const result = await handler({ from: sacramento, to: hospital });
    expect(result.demo).toBe(true);
    expect(result.sources[0]?.name).toContain("straight line in demo mode");
    // Two points: start and end, with nothing pretending to be a road between.
    const line = result.map?.layers[0]?.geojson.features[0]?.geometry as {
      coordinates: unknown[];
    };
    expect(line.coordinates).toHaveLength(2);
  });

  it("falls back to a neutral name when the caller gives none", async () => {
    const result = await handler({ from: sacramento, to: hospital });
    expect(result.summary).toMatch(/^your destination is/);
  });
});
