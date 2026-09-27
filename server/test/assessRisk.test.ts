/**
 * assess_risk end to end against the recorded fixtures (SPEC 5.3, 6). The rules
 * themselves live in rules.test.ts; this covers the orchestration: every source
 * is gathered, the layers are merged, and a dead source degrades rather than fails.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { safetyToolResultSchema } from "@safezone/shared";
import type { assessRiskTool } from "../src/tools/assessRisk.js";

process.env.DEMO_MODE = "true";

const sacramento = { lat: 38.5816, lon: -121.4944 };
const hilo = { lat: 19.707, lon: -155.0885 };
const chicago = { lat: 41.8781, lon: -87.6298 };

let handler: typeof assessRiskTool.handler;

beforeAll(async () => {
  ({
    assessRiskTool: { handler },
  } = await import("../src/tools/assessRisk.js"));
});

describe("assess_risk", () => {
  it("gathers every source and returns one valid result", async () => {
    const result = await handler({ ...sacramento, radius_km: 50 });
    expect(safetyToolResultSchema.parse(result)).toBeTruthy();
    expect(result.demo).toBe(true);
    expect(result.data.sources_checked).toEqual(["fires", "alerts", "air", "wind", "quakes"]);
    expect(result.data.sources_unavailable).toEqual([]);
    // Every source's layers arrive in one answer, with no duplicate ids.
    const ids = result.map?.layers.map((layer) => layer.id) ?? [];
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toEqual(expect.arrayContaining(["fires", "air", "wind", "quakes"]));
    expect(result.sources.length).toBeGreaterThan(2);
  });

  it("accepts a place name instead of coordinates and draws the home marker", async () => {
    const result = await handler({ place: "Sacramento", radius_km: 50 });
    expect(result.data.place).toContain("Sacramento");
    expect(result.map?.layers.some((layer) => layer.kind === "home")).toBe(true);
    expect(Number(result.data.lat)).toBeCloseTo(sacramento.lat, 1);
  });

  it("rejects a call with neither coordinates nor a place", async () => {
    await expect(handler({ radius_km: 50 })).rejects.toThrow(/place name/i);
  });

  it("finds the fire near Sacramento and explains it", async () => {
    const result = await handler({ ...sacramento, radius_km: 50 });
    const factors = result.data.factors as { id: string; severity: string }[];
    expect(factors.some((factor) => factor.id.startsWith("fire"))).toBe(true);
    expect(result.severity).not.toBe("none");
    expect(result.summary).toMatch(/^Risk level is/);
    expect(result.data.recommendations).not.toHaveLength(0);
  });

  it("reports the storm warning in Hawaii as the leading factor", async () => {
    const result = await handler({ ...hilo, radius_km: 50 });
    const factors = result.data.factors as { id: string; title: string }[];
    expect(factors[0]?.id).toBe("official-alert");
    expect(result.severity).toBe("high");
    expect(result.data.recommendations[0]).toMatch(/official instructions|local authorities/i);
  });

  it("reports no hazards for a calm location", async () => {
    const result = await handler({ ...chicago, radius_km: 50 });
    expect(result.severity).toBe("none");
    expect(result.data.factors).toEqual([]);
    expect(result.summary).toMatch(/no active hazards/i);
  });

  it("keeps a spoken-length summary with no raw coordinates", async () => {
    const result = await handler({ ...sacramento, radius_km: 50 });
    expect(result.summary).not.toMatch(/-?\d+\.\d{3,}/);
    expect(result.summary.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(3);
  });

  /**
   * The rules are tested on their own in rules.test.ts. This one proves the
   * wiring: that a real wind reading reaches the upwind rule with the
   * meteorological convention intact (SPEC 6.2). If risk/inputs.ts ever mapped
   * `from_deg` or `bearing_deg` wrongly, the rule would silently never fire.
   */
  it("raises the level when the recorded fire is upwind of the user", async () => {
    const wind = await import("../src/tools/getWind.js");
    const original = wind.getWindTool.handler;
    const recorded = await original(sacramento);
    // The fixture fire near Sacramento sits to the north-east.
    expect(Number((recorded.data as { to_deg: number }).to_deg)).toBeDefined();

    const northEasterly = async () => ({
      ...recorded,
      // Wind FROM the north-east, strong enough to carry the fire (SPEC 6.1).
      data: { ...recorded.data, speed_kmh: 25, from_deg: 45, to_deg: 225 },
    });
    (wind.getWindTool as { handler: unknown }).handler = northEasterly;
    try {
      const result = await handler({ ...sacramento, radius_km: 50 });
      const factors = result.data.factors as { id: string; title: string }[];
      expect(factors[0]?.id).toBe("fire-upwind");
      expect(factors[0]?.title).toMatch(/upwind of you/);
      expect(result.severity).toBe("high");
      expect(result.data.recommendations).toContain(
        "Prepare a go-bag and know your evacuation route.",
      );
    } finally {
      (wind.getWindTool as { handler: unknown }).handler = original;
    }
  });

  it("leaves the level at moderate when the same fire is downwind", async () => {
    const wind = await import("../src/tools/getWind.js");
    const original = wind.getWindTool.handler;
    const recorded = await original(sacramento);
    const southWesterly = async () => ({
      ...recorded,
      // Wind FROM the south-west: the fire to the north-east blows away from us.
      data: { ...recorded.data, speed_kmh: 25, from_deg: 225, to_deg: 45 },
    });
    (wind.getWindTool as { handler: unknown }).handler = southWesterly;
    try {
      const result = await handler({ ...sacramento, radius_km: 50 });
      const factors = result.data.factors as { id: string }[];
      expect(factors[0]?.id).toBe("fire-in-radius");
      expect(result.severity).toBe("moderate");
    } finally {
      (wind.getWindTool as { handler: unknown }).handler = original;
    }
  });

  it("degrades to partial data when a source throws", async () => {
    const wind = await import("../src/tools/getWind.js");
    const original = wind.getWindTool.handler;
    // Simulate Open-Meteo being down for this call only.
    (wind.getWindTool as { handler: unknown }).handler = async () => {
      throw new Error("Open-Meteo timed out");
    };
    try {
      const result = await handler({ ...sacramento, radius_km: 50 });
      expect(safetyToolResultSchema.parse(result)).toBeTruthy();
      expect(result.data.sources_unavailable).toEqual(["wind"]);
      expect(result.summary).toContain("wind temporarily unavailable");
      expect(result.data.factors).not.toHaveLength(0);
    } finally {
      (wind.getWindTool as { handler: unknown }).handler = original;
    }
  });
});

describe("assess_risk map view", () => {
  it("frames the requested radius and ignores hazards outside it", async () => {
    const result = await handler({ ...sacramento, radius_km: 50 });
    const bbox = result.map?.view?.bbox;
    expect(bbox).toBeDefined();
    const [west, south, east, north] = bbox as [number, number, number, number];
    // The place asked about stays inside the frame...
    expect(sacramento.lon).toBeGreaterThan(west);
    expect(sacramento.lon).toBeLessThan(east);
    expect(sacramento.lat).toBeGreaterThan(south);
    expect(sacramento.lat).toBeLessThan(north);
    // ...and a quake 170 km away does not stretch the frame to reach it.
    const widthKm = (east - west) * 111 * Math.cos((sacramento.lat * Math.PI) / 180);
    expect(widthKm).toBeLessThan(150);
  });
});
