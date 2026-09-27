/**
 * Talks to the agent service (SPEC 7.1). The browser is stateless about tools
 * now: it posts the whole conversation and gets back a spoken reply plus the
 * tool results to draw.
 */
import { safetyToolResultSchema, type SafetyToolResult } from "@safezone/shared";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  reply: string;
  toolResults: SafetyToolResult[];
  /** The tool behind each entry of toolResults, same length and order. */
  resultTools: string[];
  toolsUsed: string[];
  scripted?: boolean;
}

export interface AgentHealth {
  mode: "bedrock" | "scripted";
  model: string | null;
  tts: "polly" | "browser";
}

export class AgentError extends Error {}

export class AgentClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<AgentHealth> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) throw new AgentError(`Agent answered HTTP ${response.status}`);
    return (await response.json()) as AgentHealth;
  }

  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    } catch (cause) {
      throw new AgentError(`I cannot reach the SafeZone agent at ${this.baseUrl}. Is it running?`, {
        cause,
      });
    }
    const body = (await response.json().catch(() => ({}))) as Partial<ChatReply> & {
      error?: string;
    };
    if (!response.ok) throw new AgentError(body.error ?? `Agent answered HTTP ${response.status}`);

    // Anything that does not match the contract is dropped rather than drawn.
    const toolResults: SafetyToolResult[] = [];
    const resultTools: string[] = [];
    (body.toolResults ?? []).forEach((candidate, index) => {
      const parsed = safetyToolResultSchema.safeParse(candidate);
      if (!parsed.success) return;
      toolResults.push(parsed.data as SafetyToolResult);
      resultTools.push(body.resultTools?.[index] ?? `result-${index}`);
    });

    return {
      reply: body.reply ?? "",
      toolResults,
      resultTools,
      toolsUsed: body.toolsUsed ?? [],
      ...(body.scripted === undefined ? {} : { scripted: body.scripted }),
    };
  }

  /**
   * Polly audio for a reply, or undefined when the agent has no TTS configured
   * (it answers 503) so the caller can use the browser voice instead.
   */
  async speech(text: string): Promise<Blob | undefined> {
    const response = await fetch(`${this.baseUrl}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return undefined;
    return response.blob();
  }
}

/** A result that only drops the marker: needed on the map, noise in the panel. */
export const isPlacementOnly = (result: SafetyToolResult): boolean => {
  const layers = result.map?.layers ?? [];
  return layers.length > 0 && layers.every((layer) => layer.kind === "home");
};

/** The three scripted questions from SPEC section 2, for the video and the judges. */
export const PRESETS = [
  "Is it safe around my home in Sacramento?",
  "How is the wind moving?",
  "Where's the nearest hospital away from the fire?",
] as const;
