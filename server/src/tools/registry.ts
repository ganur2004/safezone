/**
 * Glue between tool implementations and the MCP SDK.
 * Every tool returns a SafetyToolResult: `summary` is spoken, `structuredContent`
 * carries the map layers and data (spec 5.2).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { safetyToolResultSchema, type SafetyToolResult } from "@safezone/shared";
import type { z, ZodRawShape } from "zod";
import { SourceUnavailableError, ToolInputError } from "../lib/errors.js";

export interface SafetyTool<Shape extends ZodRawShape> {
  name: string;
  title: string;
  /** Tells the model WHEN to use the tool, not only what it does (spec 5.4). */
  description: string;
  inputSchema: Shape;
  handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<SafetyToolResult>;
}

export function defineTool<Shape extends ZodRawShape>(tool: SafetyTool<Shape>): SafetyTool<Shape> {
  return tool;
}

/** Turns a SafetyToolResult into the MCP wire format. */
export function toCallToolResult(result: SafetyToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: result.summary }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function toErrorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerSafetyTool<Shape extends ZodRawShape>(
  server: McpServer,
  tool: SafetyTool<Shape>,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: safetyToolResultSchema.shape,
      // All SafeZone tools only read public data (spec 5.1).
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    // The SDK infers the callback args from inputSchema; the cast keeps that
    // inference out of our generic signature.
    (async (input: z.infer<z.ZodObject<Shape>>): Promise<CallToolResult> => {
      try {
        return toCallToolResult(await tool.handler(input));
      } catch (error) {
        if (error instanceof ToolInputError) return toErrorResult(error.message);
        if (error instanceof SourceUnavailableError) {
          const hint = error.retryable ? " Please try again shortly." : "";
          return toErrorResult(`Sorry, ${error.message}.${hint}`);
        }
        console.error(`[${tool.name}] unexpected failure`, error);
        return toErrorResult(`Sorry, ${tool.name} failed unexpectedly.`);
      }
    }) as never,
  );
}
