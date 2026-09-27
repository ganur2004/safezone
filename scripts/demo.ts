/**
 * One-command demo (SPEC 12, M5): the MCP server with recorded fixtures plus the
 * web simulator, no API keys required. Usage: npm run demo
 */
import { spawn, type ChildProcess } from "node:child_process";

const SERVER_PORT = process.env.PORT ?? "8787";
const AGENT_PORT = process.env.AGENT_PORT ?? "8788";
const WEB_PORT = "5173";

const children: ChildProcess[] = [];

function start(
  label: string,
  color: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): void {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = `${color}[${label}]\u001b[0m`;
  const relay = (stream: NodeJS.ReadableStream | null): void => {
    stream?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  };
  relay(child.stdout);
  relay(child.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code: number): void {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("SafeZone demo — recorded data, no API keys needed.\n");

start("server", "\u001b[36m", "npm", ["run", "dev", "--workspace", "server"], {
  DEMO_MODE: "true",
  PORT: SERVER_PORT,
  ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
});

start("agent", "\u001b[33m", "npm", ["run", "dev", "--workspace", "agent"], {
  AGENT_PORT,
  MCP_SERVER_URL: `http://localhost:${SERVER_PORT}/mcp`,
  // Scripted mode: the demo must run with no AWS account (SPEC 7.4).
  BEDROCK_ENABLED: process.env.BEDROCK_ENABLED ?? "false",
  ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
});

start("web", "\u001b[35m", "npm", ["run", "dev", "--workspace", "web"], {
  VITE_AGENT_URL: `http://localhost:${AGENT_PORT}`,
});

console.log(`\nOpen http://localhost:${WEB_PORT} once Vite is ready.\n`);
