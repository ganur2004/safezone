/**
 * Protocol smoke test (spec 13): initialize, tools/list and tools/call against a
 * running server. Usage: npm run smoke [-- http://localhost:8787/mcp]
 */
const url = process.argv[2] ?? process.env.MCP_SERVER_URL ?? "http://localhost:8787/mcp";
const PROTOCOL_VERSION = "2025-11-25";

let nextId = 1;

async function call(method: string, params: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!response.ok) throw new Error(`${method} → HTTP ${response.status}`);
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (body.error) throw new Error(`${method} → ${JSON.stringify(body.error)}`);
  if (!body.result) throw new Error(`${method} → no result`);
  return body.result;
}

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`  ok  ${label}`);
}

const health = (await (await fetch(url.replace(/\/mcp$/, "/health"))).json()) as {
  ok: boolean;
  protocol: string;
};
console.log(`GET /health`);
check("health reports ok", health.ok === true);
check(`health advertises protocol ${PROTOCOL_VERSION}`, health.protocol === PROTOCOL_VERSION);

console.log("initialize");
const init = await call("initialize", {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "safezone-smoke", version: "0.1.0" },
});
check(`negotiated protocol ${PROTOCOL_VERSION}`, init.protocolVersion === PROTOCOL_VERSION);
check("server identifies itself", (init.serverInfo as { name: string }).name === "safezone");

console.log("tools/list");
const list = (await call("tools/list", {})) as {
  tools: { name: string; description?: string; annotations?: { readOnlyHint?: boolean } }[];
};
const fires = list.tools.find((tool) => tool.name === "get_fire_hotspots");
check("get_fire_hotspots is listed", fires !== undefined);
check("get_fire_hotspots is read-only", fires?.annotations?.readOnlyHint === true);

console.log("tools/call get_fire_hotspots (Sacramento)");
const result = (await call("tools/call", {
  name: "get_fire_hotspots",
  arguments: { lat: 38.5816, lon: -121.4944, radius_km: 50, days: 1 },
})) as {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: { summary?: string; map?: { layers: { id: string }[] }; demo?: boolean };
};
check("call succeeded", result.isError !== true);
check("content[0] is spoken text", result.content[0]?.type === "text");
check(
  "structuredContent carries map layers",
  (result.structuredContent?.map?.layers.length ?? 0) > 0,
);
console.log(`\nsummary: ${result.content[0]?.text}`);
console.log(`demo data: ${result.structuredContent?.demo === true}`);
console.log("\nSmoke test passed.");
