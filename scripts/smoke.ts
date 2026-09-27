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
const EXPECTED_TOOLS = [
  "assess_risk",
  "geocode",
  "get_fire_hotspots",
  "get_route",
  "get_weather_alerts",
  "get_earthquakes",
  "get_air_quality",
  "get_wind",
  "find_safe_places",
];
for (const name of EXPECTED_TOOLS) {
  const tool = list.tools.find((candidate) => candidate.name === name);
  check(`${name} is listed and read-only`, tool?.annotations?.readOnlyHint === true);
}

interface ToolCallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: {
    summary?: string;
    severity?: string;
    map?: { layers: { id: string }[] };
    demo?: boolean;
  };
}

const sacramento = { lat: 38.5816, lon: -121.4944 };
const CALLS: { name: string; args: Record<string, unknown>; expectLayers: boolean }[] = [
  { name: "assess_risk", args: { place: "Sacramento" }, expectLayers: true },
  { name: "geocode", args: { query: "Sacramento" }, expectLayers: true },
  {
    name: "get_fire_hotspots",
    args: { ...sacramento, radius_km: 50, days: 1 },
    expectLayers: true,
  },
  // Alerts draw nothing when none are active, which is the normal case.
  { name: "get_weather_alerts", args: sacramento, expectLayers: false },
  { name: "get_earthquakes", args: sacramento, expectLayers: true },
  { name: "get_air_quality", args: sacramento, expectLayers: true },
  { name: "get_wind", args: sacramento, expectLayers: true },
  { name: "find_safe_places", args: { ...sacramento, type: "hospital" }, expectLayers: true },
  {
    name: "get_route",
    args: { from: sacramento, to: { lat: 38.5729, lon: -121.461 }, label: "Sutter Medical Center" },
    expectLayers: true,
  },
];

console.log("tools/call");
for (const { name, args, expectLayers } of CALLS) {
  const result = (await call("tools/call", { name, arguments: args })) as ToolCallResult;
  check(`${name} succeeded`, result.isError !== true);
  check(`${name} returned spoken text`, result.content[0]?.type === "text");
  check(
    `${name} returned structuredContent`,
    typeof result.structuredContent?.summary === "string" &&
      result.structuredContent.summary === result.content[0]?.text,
  );
  if (expectLayers) {
    check(`${name} returned map layers`, (result.structuredContent?.map?.layers.length ?? 0) > 0);
  }
  const demo = result.structuredContent?.demo === true ? " [demo data]" : "";
  console.log(`    ${name}: ${result.content[0]?.text}${demo}`);
}

console.log("\nSmoke test passed.");
