/**
 * The Bedrock tool loop, exercised against a fake Converse client. There are no
 * AWS credentials in CI (or on the developer machines), so this is what keeps
 * the loop honest: tool conversion, multi-turn tool use, error handling and the
 * iteration cap.
 */
import { describe, expect, it, vi } from "vitest";
import type { ConverseCommandOutput, Message } from "@aws-sdk/client-bedrock-runtime";
import type { SafetyToolResult } from "@safezone/shared";
import { runAgentLoop, toBedrockMessages, toToolConfig, type Converser } from "../src/bedrock.js";
import type { SafeZoneMcpClient, ToolCallOutcome, ToolDescriptor } from "../src/mcpClient.js";

const TOOLS: ToolDescriptor[] = [
  {
    name: "get_wind",
    description: "Returns the current wind. Use for follow-up questions about wind.",
    inputSchema: { type: "object", properties: { lat: { type: "number" } }, required: ["lat"] },
  },
];

const windResult: SafetyToolResult = {
  summary: "The wind is from the west at 6 km/h (4 mph), blowing towards the east.",
  severity: "none",
  data: { from_deg: 270, to_deg: 90 },
  sources: [{ name: "Open-Meteo", url: "https://open-meteo.com/", fetchedAt: "2026-09-27" }],
};

/** Minimal stand-in for the MCP client. */
function fakeMcp(
  outcomes: Record<string, ToolCallOutcome | (() => Promise<ToolCallOutcome>)> = {},
): SafeZoneMcpClient & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    listTools: async () => TOOLS,
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const outcome = outcomes[name];
      if (typeof outcome === "function") return outcome();
      return outcome ?? { text: windResult.summary, result: windResult, isError: false };
    },
    close: async () => {},
  } as unknown as SafeZoneMcpClient & { calls: { name: string; args: Record<string, unknown> }[] };
}

const text = (value: string): ConverseCommandOutput =>
  ({
    stopReason: "end_turn",
    output: { message: { role: "assistant", content: [{ text: value }] } },
  }) as ConverseCommandOutput;

const toolUse = (name: string, input: Record<string, unknown>, id = "t1"): ConverseCommandOutput =>
  ({
    stopReason: "tool_use",
    output: {
      message: { role: "assistant", content: [{ toolUse: { toolUseId: id, name, input } }] },
    },
  }) as ConverseCommandOutput;

/** Answers with the given outputs in order and records what it was sent. */
function fakeConverser(outputs: ConverseCommandOutput[]): Converser & {
  inputs: Parameters<Converser["converse"]>[0][];
} {
  const inputs: Parameters<Converser["converse"]>[0][] = [];
  let index = 0;
  return {
    inputs,
    converse: vi.fn(async (input) => {
      inputs.push(structuredClone(input));
      return outputs[Math.min(index++, outputs.length - 1)] as ConverseCommandOutput;
    }),
  };
}

describe("toToolConfig", () => {
  it("wraps each MCP tool as a Bedrock toolSpec with its JSON schema", () => {
    const config = toToolConfig(TOOLS);
    expect(config.tools).toHaveLength(1);
    const spec = config.tools[0]?.toolSpec;
    expect(spec?.name).toBe("get_wind");
    expect(spec?.description).toContain("Use for follow-up");
    expect(spec?.inputSchema).toEqual({ json: TOOLS[0]!.inputSchema });
  });
});

describe("toBedrockMessages", () => {
  it("maps the chat history and drops empty turns", () => {
    expect(
      toBedrockMessages([
        { role: "user", content: "Is it safe in Hilo?" },
        { role: "assistant", content: "  " },
        { role: "assistant", content: "A storm warning is in effect." },
      ]),
    ).toEqual([
      { role: "user", content: [{ text: "Is it safe in Hilo?" }] },
      { role: "assistant", content: [{ text: "A storm warning is in effect." }] },
    ]);
  });
});

describe("runAgentLoop", () => {
  it("returns the reply directly when the model asks for no tools", async () => {
    const converser = fakeConverser([text("I need a place name first.")]);
    const mcp = fakeMcp();
    const reply = await runAgentLoop(converser, mcp, [{ role: "user", content: "Is it safe?" }]);
    expect(reply.reply).toBe("I need a place name first.");
    expect(reply.toolResults).toEqual([]);
    expect(reply.toolsUsed).toEqual([]);
    expect(converser.converse).toHaveBeenCalledTimes(1);
  });

  it("sends the tools and the system prompt to Bedrock", async () => {
    const converser = fakeConverser([text("done")]);
    await runAgentLoop(converser, fakeMcp(), [{ role: "user", content: "hi" }]);
    const input = converser.inputs[0]!;
    expect(input.toolConfig?.tools[0]?.toolSpec?.name).toBe("get_wind");
    expect(input.system[0]?.text).toContain("SafeZone");
    expect(input.messages).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
  });

  it("runs a requested tool, feeds the result back and returns the final answer", async () => {
    const converser = fakeConverser([
      toolUse("get_wind", { lat: 38.58, lon: -121.49 }),
      text("The wind is blowing east at 6 km/h, about 4 mph."),
    ]);
    const mcp = fakeMcp();
    const reply = await runAgentLoop(converser, mcp, [
      { role: "user", content: "How is the wind moving?" },
    ]);

    expect(mcp.calls).toEqual([{ name: "get_wind", args: { lat: 38.58, lon: -121.49 } }]);
    expect(reply.toolsUsed).toEqual(["get_wind"]);
    expect(reply.toolResults).toEqual([windResult]);
    expect(reply.reply).toContain("4 mph");

    // The second call must carry the assistant's tool request and our result.
    const second = converser.inputs[1]!.messages as Message[];
    expect(second).toHaveLength(3);
    expect(second[1]?.role).toBe("assistant");
    const resultBlock = second[2]?.content?.[0];
    expect(resultBlock).toMatchObject({
      toolResult: { toolUseId: "t1", status: "success" },
    });
  });

  it("reports a failing tool to the model instead of throwing", async () => {
    const converser = fakeConverser([
      toolUse("get_wind", { lat: 1, lon: 2 }),
      text("Wind data is unavailable right now."),
    ]);
    const mcp = fakeMcp({
      get_wind: async () => {
        throw new Error("Open-Meteo timed out");
      },
    });
    const reply = await runAgentLoop(converser, mcp, [{ role: "user", content: "wind?" }]);
    const block = converser.inputs[1]!.messages[2]?.content?.[0];
    expect(block).toMatchObject({ toolResult: { status: "error" } });
    expect(JSON.stringify(block)).toContain("Open-Meteo timed out");
    expect(reply.reply).toContain("unavailable");
  });

  it("passes an MCP error result through as an error block", async () => {
    const converser = fakeConverser([toolUse("get_wind", {}), text("I could not check that.")]);
    const mcp = fakeMcp({
      get_wind: { text: "Sorry, fire data is not configured on this server.", isError: true },
    });
    await runAgentLoop(converser, mcp, [{ role: "user", content: "wind?" }]);
    expect(converser.inputs[1]!.messages[2]?.content?.[0]).toMatchObject({
      toolResult: { status: "error" },
    });
  });

  it("stops at the iteration cap instead of looping forever", async () => {
    const converser = fakeConverser([toolUse("get_wind", {})]); // always asks again
    const reply = await runAgentLoop(converser, fakeMcp(), [{ role: "user", content: "hi" }], {
      maxIterations: 3,
    });
    expect(converser.converse).toHaveBeenCalledTimes(3);
    expect(reply.toolsUsed).toHaveLength(3);
    expect(reply.reply).toMatch(/could not finish/i);
  });

  it("collects a result from every tool the model asks for", async () => {
    const twoTools = {
      stopReason: "tool_use",
      output: {
        message: {
          role: "assistant",
          content: [
            { toolUse: { toolUseId: "a", name: "get_wind", input: {} } },
            { toolUse: { toolUseId: "b", name: "get_wind", input: { lat: 2 } } },
          ],
        },
      },
    } as ConverseCommandOutput;
    const converser = fakeConverser([twoTools, text("Both checked.")]);
    const reply = await runAgentLoop(converser, fakeMcp(), [{ role: "user", content: "hi" }]);
    expect(reply.toolsUsed).toEqual(["get_wind", "get_wind"]);
    expect(converser.inputs[1]!.messages[2]?.content).toHaveLength(2);
  });
});
