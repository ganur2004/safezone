/**
 * HTTP entrypoint: POST /mcp (Streamable HTTP, stateless) and GET /health.
 * Stateless because Alexa+ keeps the conversation itself and does not send a
 * session id, and because it lets us run on Lambda (spec 5.1).
 */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./mcp.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-protocol-version, accept");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "mcp-protocol-version");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: LATEST_PROTOCOL_VERSION,
      demoMode: config.demoMode,
    });
  });

  app.post("/mcp", handleMcpRequest);

  // A GET on /mcp would open an SSE stream; we run stateless with JSON responses.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "This server is stateless: use POST /mcp." },
      id: null,
    });
  });

  return app;
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON instead of an SSE stream, simpler on Lambda
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  createApp().listen(config.port, () => {
    console.log(
      `[safezone] MCP server on http://localhost:${config.port}/mcp ` +
        `(protocol ${LATEST_PROTOCOL_VERSION}, demoMode=${config.demoMode})`,
    );
  });
}
