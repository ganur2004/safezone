/**
 * Where the agent lives.
 *
 * On AWS the simulator is a static bundle and the agent is a Lambda Function
 * URL that only exists after deployment, so the URL is read at runtime from
 * `/config.json`, which CDK writes next to the bundle. Locally there is no such
 * file and the build-time variable (or the dev default) is used instead.
 */
const FALLBACK = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:8788";

interface RuntimeConfig {
  agentUrl?: string;
}

export async function resolveAgentUrl(): Promise<string> {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) return FALLBACK;
    const config = (await response.json()) as RuntimeConfig;
    // Function URLs come with a trailing slash; the client appends its own paths.
    return config.agentUrl ? config.agentUrl.replace(/\/$/, "") : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
