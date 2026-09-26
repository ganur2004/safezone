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

  it("advertises get_fire_hotspots as read-only with an output schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const fires = tools.find((tool) => tool.name === "get_fire_hotspots");
    expect(fires).toBeDefined();
    expect(fires?.annotations?.readOnlyHint).toBe(true);
    expect(fires?.description).toMatch(/wildfire/i);
    expect(fires?.inputSchema.required).toEqual(["lat", "lon"]);
    expect(Object.keys(fires?.outputSchema?.properties ?? {})).toContain("summary");
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
