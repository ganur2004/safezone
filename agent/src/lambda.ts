/**
 * AWS Lambda entry point for the agent service (SPEC 10).
 *
 * /api/chat holds no session state, so any invocation can answer any request.
 * The MCP client reconnects per cold start and is reused while the container lives.
 */
import serverlessExpress from "serverless-http";
import { createApp } from "./index.js";

export const handler = serverlessExpress(createApp(), {
  // Polly returns MP3; without this the body would be mangled into text.
  binary: ["audio/mpeg"],
});
