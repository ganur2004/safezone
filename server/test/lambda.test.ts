/**
 * The Lambda entry point (SPEC 10).
 *
 * This exists because of one bug that cannot happen locally: the adapter hands
 * Express a request with an empty `rawHeaders`, and the MCP transport builds its
 * Web `Request` from exactly that, so every call came back "415 Content-Type
 * must be application/json". It only appears once deployed, so it is pinned here.
 */
import { beforeAll, describe, expect, it } from "vitest";

process.env.DEMO_MODE = "true";

type Handler = (
  event: unknown,
  context: unknown,
) => Promise<{
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}>;

let handler: Handler;

beforeAll(async () => {
  ({ handler } = (await import("../src/lambda.js")) as unknown as { handler: Handler });
});

/** A Lambda Function URL event, in the v2 payload format. */
const functionUrlEvent = (path: string, body?: unknown) => ({
  version: "2.0",
  rawPath: path,
  rawQueryString: "",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-11-25",
    host: "example.lambda-url.us-east-1.on.aws",
  },
  requestContext: { http: { method: body === undefined ? "GET" : "POST", path } },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  isBase64Encoded: false,
});

describe("MCP server on Lambda", () => {
  it("answers the health check", async () => {
    const response = await handler(functionUrlEvent("/health"), {});
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, protocol: "2025-11-25" });
  });

  it("accepts a tools/call through the Function URL payload", async () => {
    const response = await handler(
      functionUrlEvent("/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "assess_risk", arguments: { place: "Sacramento" } },
      }),
      {},
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      result: { structuredContent: { severity: string; map: { layers: unknown[] } } };
    };
    expect(body.result.structuredContent.severity).toBeTruthy();
    expect(body.result.structuredContent.map.layers.length).toBeGreaterThan(0);
  });

  it("lists the tools", async () => {
    const response = await handler(
      functionUrlEvent("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      {},
    );
    const body = JSON.parse(response.body) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name)).toContain("assess_risk");
  });
});
