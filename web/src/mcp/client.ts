/**
 * Minimal MCP client over Streamable HTTP, enough for the simulator.
 *
 * The server runs stateless with JSON responses (SPEC 5.1), so a plain POST per
 * request is all we need: no session id, no SSE stream. In M4 the agent service
 * takes over and the browser talks to `/api/chat` instead.
 */
import { safetyToolResultSchema, type SafetyToolResult } from "@safezone/shared";

export const PROTOCOL_VERSION = "2025-11-25";

export interface McpTool {
  name: string;
  description?: string;
  title?: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

export class McpError extends Error {}

export class McpClient {
  private nextId = 1;

  constructor(private readonly url: string) {}

  private async call<T>(method: string, params: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      });
    } catch (cause) {
      throw new McpError(`I cannot reach the SafeZone server at ${this.url}. Is it running?`, {
        cause,
      });
    }
    if (!response.ok) throw new McpError(`The server answered HTTP ${response.status}.`);
    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) throw new McpError(body.error.message);
    if (body.result === undefined) throw new McpError("The server returned an empty result.");
    return body.result;
  }

  /** Handshake, so the UI can show the protocol version it negotiated. */
  async initialize(): Promise<{
    serverInfo: { name: string; version: string };
    protocolVersion: string;
  }> {
    return this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "safezone-web", version: "0.1.0" },
    });
  }

  async listTools(): Promise<McpTool[]> {
    const { tools } = await this.call<{ tools: McpTool[] }>("tools/list", {});
    return tools;
  }

  /** Calls a tool and validates the SafetyToolResult contract (SPEC 5.2). */
  async callTool(name: string, args: Record<string, unknown>): Promise<SafetyToolResult> {
    const result = await this.call<{
      isError?: boolean;
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
    }>("tools/call", { name, arguments: args });

    const spoken = result.content?.find((item) => item.type === "text")?.text ?? "";
    if (result.isError) throw new McpError(spoken || `${name} failed.`);

    const parsed = safetyToolResultSchema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new McpError(`${name} returned data the simulator does not understand.`);
    }
    return parsed.data as SafetyToolResult;
  }
}
