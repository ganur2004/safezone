/**
 * The browser's side of the agent contract (SPEC 7.1): everything drawn on the
 * map passes through here, so anything that does not match SafetyToolResult has
 * to be dropped rather than rendered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SafetyToolResult } from "@safezone/shared";
import { AgentClient, AgentError, isPlacementOnly } from "../src/agent/client.js";

const valid: SafetyToolResult = {
  summary: "The wind is from the west at 6 km/h (4 mph).",
  severity: "none",
  data: { from_deg: 270 },
  sources: [{ name: "Open-Meteo", url: "https://open-meteo.com/", fetchedAt: "2026-09-27" }],
  map: {
    layers: [{ id: "wind", kind: "wind", geojson: { type: "FeatureCollection", features: [] } }],
  },
};

const respondWith = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = new AgentClient("http://agent.test");

describe("AgentClient.chat", () => {
  it("returns the reply with its tool results and pairings", async () => {
    respondWith({
      reply: "It is windy.",
      toolResults: [valid],
      resultTools: ["get_wind"],
      toolsUsed: ["geocode", "get_wind"],
      scripted: true,
    });
    const reply = await client.chat([{ role: "user", content: "wind?" }]);
    expect(reply.reply).toBe("It is windy.");
    expect(reply.toolResults).toHaveLength(1);
    expect(reply.resultTools).toEqual(["get_wind"]);
    expect(reply.toolsUsed).toEqual(["geocode", "get_wind"]);
    expect(reply.scripted).toBe(true);
  });

  it("drops results that do not match the contract, keeping the pairing aligned", async () => {
    respondWith({
      reply: "partly broken",
      toolResults: [{ nope: true }, valid],
      resultTools: ["broken_tool", "get_wind"],
      toolsUsed: ["broken_tool", "get_wind"],
    });
    const reply = await client.chat([{ role: "user", content: "wind?" }]);
    expect(reply.toolResults).toEqual([valid]);
    expect(reply.resultTools).toEqual(["get_wind"]);
  });

  it("surfaces the agent's own error message", async () => {
    respondWith({ error: "The assistant could not answer: model access denied" }, 502);
    await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /model access denied/,
    );
  });

  it("explains a dead agent instead of throwing a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(AgentError);
    await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /cannot reach the SafeZone agent/,
    );
  });

  it("copes with a reply that carries no tool results", async () => {
    respondWith({ reply: "Which place do you mean?" });
    const reply = await client.chat([{ role: "user", content: "is it safe?" }]);
    expect(reply.toolResults).toEqual([]);
    expect(reply.toolsUsed).toEqual([]);
  });
});

describe("AgentClient.speech", () => {
  it("returns the audio when Polly answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["mp3"]), { status: 200 })),
    );
    await expect(client.speech("hello")).resolves.toBeInstanceOf(Blob);
  });

  it("returns undefined on 503 so the caller uses the browser voice", async () => {
    respondWith({ error: "Polly is disabled", fallback: "speechSynthesis" }, 503);
    await expect(client.speech("hello")).resolves.toBeUndefined();
  });
});

describe("isPlacementOnly", () => {
  it("is true only when the layers are just the home marker", () => {
    const home: SafetyToolResult = {
      ...valid,
      map: {
        layers: [
          { id: "home", kind: "home", geojson: { type: "FeatureCollection", features: [] } },
        ],
      },
    };
    expect(isPlacementOnly(home)).toBe(true);
    expect(isPlacementOnly(valid)).toBe(false);
    // "No active alerts" carries no layers and is a real answer.
    expect(isPlacementOnly({ ...valid, map: { layers: [] } })).toBe(false);
  });
});
