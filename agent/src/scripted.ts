/**
 * Scripted mode (SPEC 7.4): the agent without Bedrock. Keyword rules pick the
 * tools, so judges can run the whole flow with no AWS account.
 *
 * /api/chat is stateless, so context is re-derived from the history the client
 * sends: the place comes from the most recent message that names one, and the
 * fire clusters needed for "away from the fire" are fetched on the spot.
 */
import type { SafetyToolResult } from "@safezone/shared";
import type { SafeZoneMcpClient } from "./mcpClient.js";
import type { ChatMessage, ChatReply } from "./types.js";

const SAFETY_WORDS = /\b(safe|safety|danger|dangerous|risk|hazard|happening|around)\b/i;
const WIND_WORDS = /\b(wind|smoke|blow|blowing|drift|moving)\b/i;
const FIRE_WORDS = /\b(fire|fires|wildfire|hotspot|hotspots|burning)\b/i;
const AIR_WORDS = /\b(air|aqi|breathe|breathing|haze|smog)\b/i;
const QUAKE_WORDS = /\b(earthquake|earthquakes|quake|shaking|seismic)\b/i;
const ALERT_WORDS = /\b(alert|alerts|warning|warnings|watch|advisory)\b/i;
const HOSPITAL_WORDS = /\b(hospital|hospitals|emergency room)\b/i;
const FIRE_STATION_WORDS = /\b(fire station|fire department)\b/i;
const SHELTER_WORDS = /\b(shelter|shelters|evacuation|assembly point)\b/i;
const PLACE_WORDS =
  /\b(hospital|hospitals|shelter|shelters|fire station|safe place|where should i go|where can i go|nearest)\b/i;
const ROUTE_WORDS = /\b(how do i get|how far|drive|driving|route|directions|take me)\b/i;
const AWAY_WORDS = /\b(away from|avoid|avoiding|not towards|safe from)\b/i;

/** Pulls a place out of "… in Sacramento?" or "… around Los Angeles". */
export function extractPlace(question: string): string | undefined {
  const match = /\b(?:in|at|around|near|for|about)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})/.exec(
    question,
  );
  return match?.[1]?.replace(/[?.,!]+$/, "").trim();
}

/** The most recent place named anywhere in the conversation. */
export function placeFromHistory(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const place = extractPlace(message.content);
    if (place) return place;
  }
  return undefined;
}

interface FireCluster {
  lat: number;
  lon: number;
  radius_km?: number;
}

export async function runScripted(
  mcp: SafeZoneMcpClient,
  messages: ChatMessage[],
): Promise<ChatReply> {
  const question =
    [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const toolResults: SafetyToolResult[] = [];
  const resultTools: string[] = [];
  const toolsUsed: string[] = [];
  /** Results fetched only as input for another call: drawn, but not spoken. */
  const supporting = new Set<SafetyToolResult>();
  /** Tools that answered with an error, so the reply can admit what is missing. */
  const failed: string[] = [];

  const call = async (
    name: string,
    args: Record<string, unknown>,
    options: { supporting?: boolean } = {},
  ): Promise<SafetyToolResult | undefined> => {
    toolsUsed.push(name);
    const outcome = await mcp.callTool(name, args);
    if (outcome.isError) failed.push(name);
    if (outcome.result) {
      toolResults.push(outcome.result);
      resultTools.push(name);
      if (options.supporting) supporting.add(outcome.result);
    }
    return outcome.result;
  };

  // 1. Where are we? The place may have been named several turns ago.
  const named = placeFromHistory(messages) ?? question;
  const geocoded = await call("geocode", { query: named });
  if (!geocoded) {
    return {
      reply: `I could not find a place called "${named}".`,
      toolResults,
      resultTools,
      toolsUsed,
      scripted: true,
    };
  }
  const point = { lat: Number(geocoded.data.lat), lon: Number(geocoded.data.lon) };

  // 2. Which tools does the question call for?
  if (PLACE_WORDS.test(question)) {
    const type = HOSPITAL_WORDS.test(question)
      ? "hospital"
      : FIRE_STATION_WORDS.test(question)
        ? "fire_station"
        : SHELTER_WORDS.test(question)
          ? "shelter"
          : "any";

    // "away from the fire" needs the fire clusters, so fetch them first. The
    // user asked about a hospital, so those fires belong on the map but not in
    // the spoken answer.
    let avoid: { lat: number; lon: number; radius_km: number }[] = [];
    if (AWAY_WORDS.test(question)) {
      const fires = await call(
        "get_fire_hotspots",
        { ...point, radius_km: 50, days: 1 },
        { supporting: true },
      );
      const clusters = fires?.data.clusters;
      if (Array.isArray(clusters)) {
        avoid = (clusters as FireCluster[]).slice(0, 3).map((cluster) => ({
          lat: cluster.lat,
          lon: cluster.lon,
          radius_km: Math.max(5, cluster.radius_km ?? 5),
        }));
      }
    }
    const places = await call("find_safe_places", {
      ...point,
      type,
      radius_km: 25,
      ...(avoid.length > 0 ? { avoid } : {}),
    });

    // "How do I get to the nearest hospital?" — route to whatever we just picked.
    if (ROUTE_WORDS.test(question)) {
      const best = (places?.data.places as { lat: number; lon: number; name: string }[])?.[0];
      if (best) {
        await call("get_route", {
          from: point,
          to: { lat: best.lat, lon: best.lon },
          label: best.name,
        });
      }
    }
  } else {
    const narrow: { tool: string; args: Record<string, unknown> }[] = [];
    if (FIRE_WORDS.test(question)) {
      narrow.push({ tool: "get_fire_hotspots", args: { ...point, radius_km: 50, days: 1 } });
    }
    if (WIND_WORDS.test(question)) narrow.push({ tool: "get_wind", args: point });
    if (AIR_WORDS.test(question)) narrow.push({ tool: "get_air_quality", args: point });
    if (QUAKE_WORDS.test(question)) narrow.push({ tool: "get_earthquakes", args: point });
    if (ALERT_WORDS.test(question)) narrow.push({ tool: "get_weather_alerts", args: point });

    // A general "is it safe" question is exactly what assess_risk is for: one
    // call, every source, and a reasoned level instead of four summaries.
    const wanted =
      narrow.length > 0
        ? narrow
        : SAFETY_WORDS.test(question) || messages.length <= 1
          ? [{ tool: "assess_risk", args: { ...point, radius_km: 50 } }]
          : [];

    // One dead source must not sink the whole answer (SPEC 5.6).
    for (const { tool, args } of wanted) {
      try {
        await call(tool, args);
      } catch (error) {
        console.warn(`[scripted] ${tool} failed`, error);
      }
    }
  }

  return {
    reply: speak(toolResults, supporting, failed),
    toolResults,
    resultTools,
    toolsUsed,
    scripted: true,
  };
}

/** A result that only drops the marker: needed on the map, noise when spoken. */
export const isPlacementOnly = (result: SafetyToolResult): boolean => {
  const layers = result.map?.layers ?? [];
  return layers.length > 0 && layers.every((layer) => layer.kind === "home");
};

/** What each tool was there to answer, for when it could not. */
const TOOL_SUBJECT: Record<string, string> = {
  get_fire_hotspots: "the fire data",
  get_weather_alerts: "official alerts",
  get_air_quality: "air quality",
  get_wind: "the wind",
  get_earthquakes: "earthquake data",
  find_safe_places: "the place search",
  get_route: "routing",
  assess_risk: "the risk assessment",
};

function speak(
  results: SafetyToolResult[],
  supporting: Set<SafetyToolResult>,
  failed: string[],
): string {
  const spoken = results.filter((result) => !isPlacementOnly(result) && !supporting.has(result));
  if (spoken.length > 0) {
    return spoken
      .map((result) => result.summary.trim())
      .filter(Boolean)
      .join(" ");
  }

  /*
   * Nothing to say. Falling back to whatever is left would answer a question
   * about hospitals with "Sacramento is at the location I will use", which is
   * how this read when Overpass returned 504 on the deployed demo. Name what
   * failed instead: the sources here are public and go down regularly.
   */
  const subjects = [...new Set(failed.map((tool) => TOOL_SUBJECT[tool] ?? tool))];
  if (subjects.length > 0) {
    const list =
      subjects.length === 1
        ? subjects[0]
        : `${subjects.slice(0, -1).join(", ")} and ${subjects.at(-1)}`;
    return `I could not reach ${list} just now. Please try again in a moment.`;
  }
  return "I could not find anything to report for that place.";
}
