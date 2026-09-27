/** The contract between the simulator and the agent (SPEC 7.1). */
import type { SafetyToolResult } from "@safezone/shared";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  reply: string;
  toolResults: SafetyToolResult[];
  /**
   * The tool behind each entry of `toolResults`, same length and order. A tool
   * that failed appears in `toolsUsed` but produces no result, so the two arrays
   * cannot be zipped — this one can.
   */
  resultTools: string[];
  /** Every tool that ran, in order, including the ones that failed. */
  toolsUsed: string[];
  /** true when the reply came from the scripted fallback rather than Bedrock. */
  scripted?: boolean;
}
