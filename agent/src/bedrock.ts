/**
 * The Bedrock half of the agent (SPEC 7.2): a Converse tool-use loop over the
 * MCP tools.
 *
 * Bedrock is injected rather than constructed here so the loop can be tested
 * without AWS credentials.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { SafeZoneMcpClient, ToolDescriptor } from "./mcpClient.js";
import type { ChatMessage, ChatReply } from "./types.js";

/** Just the part of the Bedrock client the loop uses, so tests can fake it. */
export interface Converser {
  converse(input: {
    modelId: string;
    messages: Message[];
    system: { text: string }[];
    toolConfig?: { tools: Tool[] };
  }): Promise<ConverseCommandOutput>;
}

export function bedrockConverser(): Converser {
  const client = new BedrockRuntimeClient({ region: config.awsRegion });
  return {
    converse: (input) => client.send(new ConverseCommand(input)),
  };
}

/** MCP tool definitions in the shape Bedrock's Converse API expects. */
export function toToolConfig(tools: ToolDescriptor[]): { tools: Tool[] } {
  return {
    // `Tool` is a tagged union whose members each carry a `$unknown` variant, so
    // the member is built explicitly rather than inferred from the literal.
    tools: tools.map((tool): Tool => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        // The schema is already JSON Schema; DocumentType is the SDK's name for it.
        inputSchema: { json: tool.inputSchema as DocumentType },
      },
    })),
  };
}

export function toBedrockMessages(messages: ChatMessage[]): Message[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    }));
}

const textOf = (content: ContentBlock[] | undefined): string =>
  (content ?? [])
    .map((block) => ("text" in block ? (block.text ?? "") : ""))
    .join(" ")
    .trim();

/**
 * Runs the conversation until the model stops asking for tools, or until the
 * iteration cap. Every tool result is collected for the map.
 */
export async function runAgentLoop(
  converser: Converser,
  mcp: SafeZoneMcpClient,
  history: ChatMessage[],
  options: { maxIterations?: number; modelId?: string } = {},
): Promise<ChatReply> {
  const maxIterations = options.maxIterations ?? config.maxToolIterations;
  const modelId = options.modelId ?? config.bedrockModelId;
  const toolConfig = toToolConfig(await mcp.listTools());
  const messages = toBedrockMessages(history);
  const toolResults: ChatReply["toolResults"] = [];
  const resultTools: string[] = [];
  const toolsUsed: string[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const response = await converser.converse({
      modelId,
      messages,
      system: [{ text: SYSTEM_PROMPT }],
      ...(toolConfig.tools.length > 0 ? { toolConfig } : {}),
    });

    const assistantContent = response.output?.message?.content ?? [];
    messages.push({ role: "assistant", content: assistantContent });

    if (response.stopReason !== "tool_use") {
      return { reply: textOf(assistantContent), toolResults, resultTools, toolsUsed };
    }

    // Run every requested tool, then hand all results back in one user turn,
    // which is what the Converse API expects.
    const requests = assistantContent.flatMap((block) =>
      "toolUse" in block && block.toolUse ? [block.toolUse] : [],
    );
    const resultBlocks: ContentBlock[] = [];
    for (const request of requests) {
      const name = request.name ?? "";
      const args = (request.input ?? {}) as Record<string, unknown>;
      toolsUsed.push(name);
      try {
        const outcome = await mcp.callTool(name, args);
        if (outcome.result) {
          toolResults.push(outcome.result);
          resultTools.push(name);
        }
        resultBlocks.push({
          toolResult: {
            toolUseId: request.toolUseId ?? "",
            content: [{ text: outcome.text || JSON.stringify(outcome.result ?? {}) }],
            status: outcome.isError ? "error" : "success",
          },
        });
      } catch (error) {
        // A dead source must not end the conversation: tell the model and carry on.
        resultBlocks.push({
          toolResult: {
            toolUseId: request.toolUseId ?? "",
            content: [{ text: `${name} is unavailable: ${(error as Error).message}` }],
            status: "error",
          },
        });
      }
    }
    messages.push({ role: "user", content: resultBlocks });
  }

  return {
    reply:
      "I gathered a lot of data but could not finish the answer. Please ask again, more specifically.",
    toolResults,
    resultTools,
    toolsUsed,
  };
}
