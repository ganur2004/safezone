/**
 * MCP client side of the agent (SPEC 7.2): connects to the SafeZone server over
 * Streamable HTTP, lists the tools and calls them.
 *
 * The server is stateless, so a connection is cheap and reconnecting after a
 * failure costs nothing.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { safetyToolResultSchema, type SafetyToolResult } from "@safezone/shared";
import { config } from "./config.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema, passed to Bedrock as the tool's input schema. */
  inputSchema: Record<string, unknown>;
}

/** What a tool call produced: the spoken text plus the structured payload. */
export interface ToolCallOutcome {
  text: string;
  result?: SafetyToolResult;
  isError: boolean;
}

export class SafeZoneMcpClient {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  constructor(private readonly url: string = config.mcpServerUrl) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const client = new Client({ name: "safezone-agent", version: "0.1.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } catch (error) {
      // Let the next request try again rather than caching a failed connection.
      this.connecting = undefined;
      throw error;
    }
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    const client = await this.connect();
    const response = await client.callTool({ name, arguments: args });
    const content = (response.content ?? []) as { type: string; text?: string }[];
    const text = content.find((item) => item.type === "text")?.text ?? "";
    if (response.isError) return { text: text || `${name} failed.`, isError: true };

    const parsed = safetyToolResultSchema.safeParse(response.structuredContent);
    return parsed.success
      ? { text, result: parsed.data as SafetyToolResult, isError: false }
      : { text, isError: false };
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.connecting = undefined;
  }
}
