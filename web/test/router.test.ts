/**
 * The keyword router is the only decision-making left in the browser until M4,
 * so its behaviour is pinned down here with a stubbed MCP client.
 */
import { describe, expect, it, vi } from "vitest";
import type { SafetyToolResult } from "@safezone/shared";
import {
  PRESETS,
  ask,
  extractPlace,
  isPlacementOnly,
  worstSeverity,
  type RouterState,
  type ToolCaller,
} from "../src/mcp/router.js";

const result = (over: Partial<SafetyToolResult> = {}): SafetyToolResult => ({
  summary: "ok",
  data: {},
  sources: [{ name: "test", url: "https://example.com", fetchedAt: "2026-09-27T00:00:00Z" }],
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

/** Records every call and answers with a canned result per tool. */
function stub(answers: Record<string, SafetyToolResult> = {}): ToolCaller & {
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return (
        answers[name] ??
        (name === "geocode" ? geocoded("Sacramento, California", 38.58, -121.49) : result())
      );
    }),
  };
}

const fresh = (): RouterState => ({ fireClusters: [] });

describe("extractPlace", () => {
  it("pulls the place out of a natural question", () => {
    expect(extractPlace("Is it safe around my home in Sacramento?")).toBe("Sacramento");
    expect(extractPlace("What about Los Angeles?")).toBe("Los Angeles");
    expect(extractPlace("How is the air in New York City?")).toBe("New York City");
  });

  it("returns nothing for a follow-up without a place", () => {
    expect(extractPlace("How is the wind moving?")).toBeUndefined();
    expect(extractPlace("Where is the nearest hospital?")).toBeUndefined();
  });
});

describe("worstSeverity", () => {
  it("takes the most serious result", () => {
    expect(worstSeverity([])).toBe("none");
    expect(
      worstSeverity([result({ severity: "low" }), result({ severity: "high" }), result()]),
    ).toBe("high");
  });
});

describe("isPlacementOnly", () => {
  it("is true only for a result whose layers are just the home marker", () => {
    expect(isPlacementOnly(geocoded("Sacramento", 38.58, -121.49))).toBe(true);
    // "No active alerts" has no layers at all and is a real answer.
    expect(isPlacementOnly(result({ map: { layers: [] } }))).toBe(false);
    expect(isPlacementOnly(result())).toBe(false);
  });
});

describe("ask", () => {
  it("geocodes then asks every source for a general safety question", async () => {
    const client = stub();
    const { turn, state } = await ask(client, PRESETS[0], fresh());
    expect(client.calls.map((call) => call.name)).toEqual([
      "geocode",
      "get_fire_hotspots",
      "get_weather_alerts",
      "get_air_quality",
      "get_wind",
    ]);
    expect(state.place?.label).toBe("Sacramento, California");
    expect(turn.placeChanged).toBe(true);
    // The geocode line is not spoken when there is something real to say.
    expect(turn.reply).not.toMatch(/location I will use/);
  });

  it("reuses the remembered place for a follow-up and calls only the narrow tool", async () => {
    const client = stub();
    const first = await ask(client, PRESETS[0], fresh());
    client.calls.length = 0;
    const { turn } = await ask(client, PRESETS[1], first.state);
    expect(client.calls.map((call) => call.name)).toEqual(["get_wind"]);
    expect(client.calls[0]?.args).toMatchObject({ lat: 38.58, lon: -121.49 });
    expect(turn.placeChanged).toBe(false);
  });

  it("passes remembered fire clusters as avoid zones for 'away from the fire'", async () => {
    const client = stub({
      get_fire_hotspots: result({
        severity: "moderate",
        summary: "14 active fire hotspots.",
        data: {
          clusters: [
            { lat: 38.7, lon: -121.36, count: 9, distance_km: 17.2 },
            { lat: 38.78, lon: -121.28, count: 3, distance_km: 27.9 },
          ],
        },
        map: {
          layers: [
            { id: "fires", kind: "fires", geojson: { type: "FeatureCollection", features: [] } },
          ],
        },
      }),
    });
    const first = await ask(client, PRESETS[0], fresh());
    client.calls.length = 0;

    const { turn } = await ask(client, PRESETS[2], first.state);
    expect(client.calls.map((call) => call.name)).toEqual(["find_safe_places"]);
    const args = client.calls[0]?.args as {
      type: string;
      avoid: { lat: number; radius_km: number }[];
    };
    expect(args.type).toBe("hospital");
    expect(args.avoid).toHaveLength(2);
    expect(args.avoid[0]).toMatchObject({ lat: 38.7, radius_km: 5 });
    expect(turn.outcomes[0]?.tool).toBe("find_safe_places");
  });

  it("omits avoid when nothing is burning", async () => {
    const client = stub();
    const first = await ask(client, PRESETS[0], fresh());
    client.calls.length = 0;
    await ask(client, "Where is the nearest hospital?", first.state);
    expect(client.calls[0]?.args).not.toHaveProperty("avoid");
  });

  it("re-geocodes and reports a place change when the question names a new place", async () => {
    const client = stub();
    const first = await ask(client, PRESETS[0], fresh());
    const second = await ask(
      {
        ...client,
        callTool: async (name, args) => {
          client.calls.push({ name, args });
          return name === "geocode" ? geocoded("Hilo, Hawaii", 19.7, -155.09) : result();
        },
      },
      "Is it safe in Hilo?",
      first.state,
    );
    expect(second.turn.placeChanged).toBe(true);
    expect(second.state.place?.label).toBe("Hilo, Hawaii");
  });

  it("still answers when one source fails", async () => {
    const failing: ToolCaller = {
      callTool: async (name) => {
        if (name === "geocode") return geocoded("Sacramento, California", 38.58, -121.49);
        if (name === "get_fire_hotspots") throw new Error("FIRMS is down");
        return result({ summary: `${name} ok` });
      },
    };
    const { turn } = await ask(failing, PRESETS[0], fresh());
    expect(turn.outcomes.map((outcome) => outcome.tool)).toEqual([
      "geocode",
      "get_weather_alerts",
      "get_air_quality",
      "get_wind",
    ]);
    expect(turn.reply).toContain("get_wind ok");
  });
});
