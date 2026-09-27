/**
 * Scripted mode is what runs without AWS, so it carries the demo. Unlike the
 * Bedrock loop it has to re-derive context from the history on every request.
 */
import { describe, expect, it, vi } from "vitest";
import type { SafetyToolResult } from "@safezone/shared";
import { extractPlace, isPlacementOnly, placeFromHistory, runScripted } from "../src/scripted.js";
import type { SafeZoneMcpClient, ToolCallOutcome } from "../src/mcpClient.js";

const result = (over: Partial<SafetyToolResult> = {}): SafetyToolResult => ({
  summary: "ok",
  data: {},
  sources: [{ name: "test", url: "https://example.com", fetchedAt: "2026-09-27" }],
  ...over,
});

const geocoded = (label: string, lat: number, lon: number): SafetyToolResult =>
  result({
    summary: `${label} is at the location I will use for the next answers.`,
    severity: "none",
    data: { label, name: label.split(",")[0], lat, lon },
    map: {
      view: { center: [lon, lat], zoom: 10 },
      layers: [{ id: "home", kind: "home", geojson: { type: "FeatureCollection", features: [] } }],
    },
  });

const fires = result({
  summary: "14 active fire hotspots within 50 km (31 mi).",
  severity: "moderate",
  data: {
    clusters: [
      { lat: 38.7, lon: -121.36, count: 9, distance_km: 17.2 },
      { lat: 38.78, lon: -121.28, count: 3, distance_km: 27.9 },
    ],
  },
  map: {
    layers: [{ id: "fires", kind: "fires", geojson: { type: "FeatureCollection", features: [] } }],
  },
});

function fakeMcp(
  overrides: Record<string, SafetyToolResult | (() => Promise<ToolCallOutcome>)> = {},
): SafeZoneMcpClient & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    listTools: async () => [],
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const override = overrides[name];
      if (typeof override === "function") return override();
      if (override) return { text: override.summary, result: override, isError: false };
      if (name === "geocode") {
        const value = geocoded("Sacramento, California", 38.58, -121.49);
        return { text: value.summary, result: value, isError: false };
      }
      const value = result({ summary: `${name} ok` });
      return { text: value.summary, result: value, isError: false };
    }),
    close: async () => {},
  } as unknown as SafeZoneMcpClient & { calls: { name: string; args: Record<string, unknown> }[] };
}

describe("extractPlace / placeFromHistory", () => {
  it("finds a place named in the question", () => {
    expect(extractPlace("Is it safe around my home in Sacramento?")).toBe("Sacramento");
    expect(extractPlace("How is the wind moving?")).toBeUndefined();
  });

  it("falls back to the most recent place named earlier in the conversation", () => {
    expect(
      placeFromHistory([
        { role: "user", content: "Is it safe in Sacramento?" },
        { role: "assistant", content: "Fires north-east." },
        { role: "user", content: "How is the wind moving?" },
      ]),
    ).toBe("Sacramento");
  });

  it("prefers the newest place when the user moves on", () => {
    expect(
      placeFromHistory([
        { role: "user", content: "Is it safe in Sacramento?" },
        { role: "user", content: "What about Hilo?" },
      ]),
    ).toBe("Hilo");
  });

  it("ignores places mentioned only by the assistant", () => {
    expect(
      placeFromHistory([{ role: "assistant", content: "There are fires in Sacramento." }]),
    ).toBeUndefined();
  });
});

describe("isPlacementOnly", () => {
  it("is true only when the layers are just the home marker", () => {
    expect(isPlacementOnly(geocoded("Sacramento", 38.58, -121.49))).toBe(true);
    expect(isPlacementOnly(result({ map: { layers: [] } }))).toBe(false);
    expect(isPlacementOnly(fires)).toBe(false);
  });
});

describe("runScripted", () => {
  it("geocodes then uses assess_risk for a general safety question", async () => {
    const mcp = fakeMcp();
    const reply = await runScripted(mcp, [
      { role: "user", content: "Is it safe around my home in Sacramento?" },
    ]);
    // One call instead of four: assess_risk gathers the sources server-side.
    expect(mcp.calls.map((call) => call.name)).toEqual(["geocode", "assess_risk"]);
    expect(mcp.calls[1]?.args).toEqual({ lat: 38.58, lon: -121.49, radius_km: 50 });
    expect(reply.scripted).toBe(true);
    expect(reply.toolResults).toHaveLength(2);
    // The geocode line is dropped from the spoken reply when there is real news.
    expect(reply.reply).not.toMatch(/location I will use/);
  });

  it("answers a follow-up with one tool, reusing the place from the history", async () => {
    const mcp = fakeMcp();
    const reply = await runScripted(mcp, [
      { role: "user", content: "Is it safe around my home in Sacramento?" },
      { role: "assistant", content: "14 active fire hotspots." },
      { role: "user", content: "How is the wind moving?" },
    ]);
    expect(mcp.calls.map((call) => call.name)).toEqual(["geocode", "get_wind"]);
    expect(mcp.calls[0]?.args).toEqual({ query: "Sacramento" });
    expect(mcp.calls[1]?.args).toEqual({ lat: 38.58, lon: -121.49 });
    expect(reply.reply).toBe("get_wind ok");
  });

  it("fetches fire clusters and avoids them for 'nearest hospital away from the fire'", async () => {
    const mcp = fakeMcp({ get_fire_hotspots: fires });
    await runScripted(mcp, [
      { role: "user", content: "Is it safe around my home in Sacramento?" },
      { role: "assistant", content: "14 active fire hotspots." },
      { role: "user", content: "Where's the nearest hospital away from the fire?" },
    ]);
    expect(mcp.calls.map((call) => call.name)).toEqual([
      "geocode",
      "get_fire_hotspots",
      "find_safe_places",
    ]);
    const args = mcp.calls[2]?.args as {
      type: string;
      avoid: { lat: number; radius_km: number }[];
    };
    expect(args.type).toBe("hospital");
    expect(args.avoid).toHaveLength(2);
    expect(args.avoid[0]).toMatchObject({ lat: 38.7, radius_km: 5 });
  });

  it("does not look for fires when the question is just 'nearest hospital'", async () => {
    const mcp = fakeMcp();
    await runScripted(mcp, [{ role: "user", content: "Where is the nearest hospital in Boise?" }]);
    expect(mcp.calls.map((call) => call.name)).toEqual(["geocode", "find_safe_places"]);
    expect(mcp.calls[1]?.args).not.toHaveProperty("avoid");
  });

  it("keeps answering when a narrow tool fails", async () => {
    const mcp = fakeMcp({
      get_fire_hotspots: async () => {
        throw new Error("FIRMS is down");
      },
    });
    const reply = await runScripted(mcp, [
      { role: "user", content: "Are there fires or wind in Sacramento?" },
    ]);
    expect(reply.toolsUsed).toContain("get_fire_hotspots");
    expect(reply.reply).toContain("get_wind ok");
  });

  it("says so when the place cannot be found", async () => {
    const mcp = fakeMcp({
      geocode: async () => ({ text: "I could not find that place.", isError: true }),
    });
    const reply = await runScripted(mcp, [{ role: "user", content: "Is it safe in Atlantis?" }]);
    expect(reply.reply).toMatch(/could not find a place called "Atlantis"/);
    expect(mcp.calls).toHaveLength(1);
  });
});
