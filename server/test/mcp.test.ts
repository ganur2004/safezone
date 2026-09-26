/** Protocol test (spec 13): initialize, tools/list and tools/call over the real transport. */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { safetyToolResultSchema } from "@safezone/shared";

process.env.DEMO_MODE = "true";

async function connect() {
  const { createMcpServer } = await import("../src/mcp.js");
  const server = createMcpServer();
  const client = new Client({ name: "safezone-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("safezone MCP server", () => {
  it("speaks the 2025-11-25 protocol version", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
  });

  it("advertises every tool as read-only with an output schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "find_safe_places",
      "geocode",
      "get_air_quality",
      "get_earthquakes",
      "get_fire_hotspots",
      "get_weather_alerts",
      "get_wind",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(Object.keys(tool.outputSchema?.properties ?? {}), tool.name).toContain("summary");
      // The description has to say WHEN to use the tool (spec 5.4).
      expect(tool.description ?? "", tool.name).toMatch(/\bUse\b/);
    }
    const fires = tools.find((tool) => tool.name === "get_fire_hotspots");
    expect(fires?.description).toMatch(/wildfire/i);
    expect(fires?.inputSchema.required).toEqual(["lat", "lon"]);
  });

  it("answers tools/call with a spoken summary and structured content", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "get_fire_hotspots",
      arguments: { lat: 38.5816, lon: -121.4944 },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe("text");
    const parsed = safetyToolResultSchema.parse(result.structuredContent);
    expect(content[0]?.text).toBe(parsed.summary);
    expect(parsed.map?.layers.length).toBe(2);
  });

  it("answers each location tool over the protocol", async () => {
    const { client } = await connect();
    const point = { lat: 19.707, lon: -155.0885 };
    for (const name of [
      "get_weather_alerts",
      "get_earthquakes",
      "get_air_quality",
      "get_wind",
      "find_safe_places",
    ]) {
      const result = await client.callTool({ name, arguments: point });
      expect(result.isError, name).toBeFalsy();
      const parsed = safetyToolResultSchema.parse(result.structuredContent);
      const content = result.content as { text: string }[];
      expect(content[0]?.text, name).toBe(parsed.summary);
    }
  });

  it("rejects out-of-range coordinates with an error result, not a crash", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "get_fire_hotspots",
      arguments: { lat: 999, lon: 0 },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]?.text).toMatch(/lat/);
  });
});
