/** Builds the "safezone" MCP server instance (spec 5.1). */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findSafePlacesTool } from "./tools/findSafePlaces.js";
import { geocodeTool } from "./tools/geocode.js";
import { getAirQualityTool } from "./tools/getAirQuality.js";
import { getEarthquakesTool } from "./tools/getEarthquakes.js";
import { getFireHotspotsTool } from "./tools/getFireHotspots.js";
import { getWeatherAlertsTool } from "./tools/getWeatherAlerts.js";
import { getWindTool } from "./tools/getWind.js";
import { registerSafetyTool } from "./tools/registry.js";

export const SERVER_NAME = "safezone";
export const SERVER_VERSION = "0.1.0";

/**
 * A fresh server per request: the transport is stateless, so nothing may be
 * shared between calls except the module-level cache (spec 5.1).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "SafeZone reports hazards near a place: wildfire hotspots, weather alerts, earthquakes, " +
        "air quality and wind. Every tool returns a short spoken summary plus map layers. " +
        "This is a demonstration project and never replaces official emergency services.",
    },
  );

  registerSafetyTool(server, geocodeTool);
  registerSafetyTool(server, getFireHotspotsTool);
  registerSafetyTool(server, getWeatherAlertsTool);
  registerSafetyTool(server, getEarthquakesTool);
  registerSafetyTool(server, getAirQualityTool);
  registerSafetyTool(server, getWindTool);
  registerSafetyTool(server, findSafePlacesTool);

  return server;
}
