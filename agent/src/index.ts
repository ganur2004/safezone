/**
 * The agent service (SPEC 7): it plays the part Alexa+ plays for a real device.
 * POST /api/chat runs the tool loop, POST /api/tts speaks a reply.
 */
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { SafeZoneMcpClient } from "./mcpClient.js";
import { bedrockConverser, runAgentLoop } from "./bedrock.js";
import { runScripted } from "./scripted.js";
import { TtsUnavailableError, synthesize } from "./tts.js";
import type { ChatReply } from "./types.js";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .min(1)
    .max(40),
});

const ttsRequestSchema = z.object({ text: z.string().min(1).max(3000) });

export function createApp(mcp = new SafeZoneMcpClient()) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "safezone-agent",
      mode: config.bedrockEnabled ? "bedrock" : "scripted",
      model: config.bedrockEnabled ? config.bedrockModelId : null,
      tts: config.pollyEnabled ? "polly" : "browser",
      mcpServerUrl: config.mcpServerUrl,
    });
  });

  app.post("/api/chat", async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send { messages: [{ role, content }] }." });
      return;
    }
    try {
      const reply: ChatReply = config.bedrockEnabled
        ? await runAgentLoop(bedrockConverser(), mcp, parsed.data.messages)
        : await runScripted(mcp, parsed.data.messages);
      res.json(reply);
    } catch (error) {
      console.error("[chat] failed", error);
      // Bedrock's own message is useful here: "model access denied" tells the
      // operator exactly what to fix.
      res.status(502).json({
        error: `The assistant could not answer: ${(error as Error).message}`,
      });
    }
  });

  app.post("/api/tts", async (req: Request, res: Response) => {
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send { text }." });
      return;
    }
    try {
      const audio = await synthesize(parsed.data.text);
      res.setHeader("content-type", "audio/mpeg");
      res.setHeader("cache-control", "no-store");
      res.send(Buffer.from(audio));
    } catch (error) {
      const unavailable = error instanceof TtsUnavailableError;
      if (!unavailable) console.error("[tts] failed", error);
      // 503 is the simulator's cue to use the browser voice instead.
      res.status(503).json({ error: (error as Error).message, fallback: "speechSynthesis" });
    }
  });

  return app;
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  createApp().listen(config.port, () => {
    console.log(
      `[safezone-agent] on http://localhost:${config.port} ` +
        `(mode=${config.bedrockEnabled ? "bedrock" : "scripted"}, ` +
        `tts=${config.pollyEnabled ? "polly" : "browser"}, mcp=${config.mcpServerUrl})`,
    );
  });
}
