/** Contract test (spec 13): the tool result must satisfy the SafetyToolResult schema. */
import { beforeAll, describe, expect, it } from "vitest";
import { safetyToolResultSchema } from "@safezone/shared";
import type { getFireHotspotsTool } from "../src/tools/getFireHotspots.js";

const sacramento = { lat: 38.5816, lon: -121.4944 };

// The tool reads config at import time, so DEMO_MODE must be set before the
// dynamic import in beforeAll (the type-only import above emits nothing).
process.env.DEMO_MODE = "true";

let handler: typeof getFireHotspotsTool.handler;

beforeAll(async () => {
  ({
    getFireHotspotsTool: { handler },
  } = await import("../src/tools/getFireHotspots.js"));
});

describe("get_fire_hotspots in DEMO_MODE", () => {
  it("returns a valid SafetyToolResult with fire and radius layers", async () => {
    const result = await handler({ ...sacramento, radius_km: 50, days: 1 });
    expect(safetyToolResultSchema.parse(result)).toBeTruthy();
    expect(result.demo).toBe(true);
    expect(result.map?.layers.map((layer) => layer.id).sort()).toEqual(["fires", "radius"]);
    expect(result.data.count).toBeGreaterThan(0);
    expect(result.severity).toBe("moderate");
    // `data` keys are snake_case, like the tool input schema.
    const clusters = result.data.clusters as { count: number; distance_km: number }[];
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]?.distance_km).toBeGreaterThan(0);
    expect(clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(result.data.count);
    expect(result.sources[0]?.name).toContain("NASA FIRMS");
  });

  it("describes the closest hotspot with a distance, bearing and direction", async () => {
    const result = await handler({ ...sacramento, radius_km: 50, days: 1 });
    const closest = result.data.closest as {
      distance_km: number;
      bearing_deg: number;
      direction: string;
      direction_spoken: string;
    };
    expect(closest.distance_km).toBeGreaterThan(0);
    expect(closest.bearing_deg).toBeGreaterThanOrEqual(0);
    expect(closest.bearing_deg).toBeLessThan(360);
    expect(closest.direction).toBe("NE");
    expect(closest.direction_spoken).toBe("north-east");
  });

  it("reports an empty result and severity none for a calm location", async () => {
    const chicago = { lat: 41.8781, lon: -87.6298 };
    const result = await handler({ ...chicago, radius_km: 50, days: 1 });
    expect(safetyToolResultSchema.parse(result)).toBeTruthy();
    expect(result.data.count).toBe(0);
    expect(result.severity).toBe("none");
    expect(result.summary).toMatch(/No active fire hotspots/);
    expect(result.map?.view?.center).toEqual([chicago.lon, chicago.lat]);
  });

  it("keeps hotspots inside the requested radius", async () => {
    const wide = await handler({ ...sacramento, radius_km: 50, days: 1 });
    const narrow = await handler({ ...sacramento, radius_km: 20, days: 1 });
    expect(Number(narrow.data.count)).toBeLessThanOrEqual(Number(wide.data.count));
  });
});
