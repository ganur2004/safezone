/** Agent configuration (SPEC 11). */

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asBoolean = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(value);

export interface Config {
  port: number;
  mcpServerUrl: string;
  bedrockEnabled: boolean;
  bedrockModelId: string;
  pollyEnabled: boolean;
  pollyVoiceId: string;
  awsRegion: string;
  allowedOrigins: string[];
  /** Hard stop on the tool loop, so a confused model cannot spin (SPEC 7.2). */
  maxToolIterations: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: asNumber(env.AGENT_PORT ?? env.PORT, 8788),
    mcpServerUrl: env.MCP_SERVER_URL?.trim() || "http://localhost:8787/mcp",
    bedrockEnabled: asBoolean(env.BEDROCK_ENABLED, false),
    // Any tool-capable model available in the account's region works (SPEC 7.2).
    bedrockModelId: env.BEDROCK_MODEL_ID?.trim() || "au.anthropic.claude-sonnet-5",
    pollyEnabled: asBoolean(env.POLLY_ENABLED, asBoolean(env.BEDROCK_ENABLED, false)),
    pollyVoiceId: env.POLLY_VOICE_ID?.trim() || "Joanna",
    awsRegion: env.AWS_REGION?.trim() || "ap-southeast-2",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxToolIterations: asNumber(env.MAX_TOOL_ITERATIONS, 5),
  };
}

export const config: Config = loadConfig();
