/**
 * AWS Lambda entry point for the MCP server (SPEC 10).
 *
 * The transport already runs stateless with JSON responses, so a plain buffered
 * Function URL is enough — no response streaming and nothing to keep between
 * invocations except the in-memory cache, which is a bonus on a warm container.
 */
import type { IncomingMessage } from "node:http";
import serverlessExpress from "serverless-http";
import { createApp } from "./index.js";

export const handler = serverlessExpress(createApp(), {
  request: (request: IncomingMessage) => {
    /**
     * The MCP SDK's Node transport converts the request to a Web standard
     * `Request`, and that conversion reads `rawHeaders`, which the Lambda
     * adapter leaves empty — every call would come back
     * "415 Content-Type must be application/json". Rebuilding rawHeaders from
     * the parsed headers is enough; it is flat [name, value, name, value].
     */
    if (request.rawHeaders?.length) return;
    request.rawHeaders = Object.entries(request.headers).flatMap(([name, value]) =>
      Array.isArray(value) ? value.flatMap((item) => [name, item]) : [name, String(value ?? "")],
    );
  },
});
