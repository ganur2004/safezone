/**
 * Temporary stand-in for the agent (SPEC 12, M3: "the front end may call the MCP
 * server directly to check the rendering"). It maps a typed question onto tool
 * calls with simple keyword rules and remembers the place and the last fire
 * clusters so follow-up questions work.
 *
 * In M4 this is replaced by the agent service: Bedrock decides which tools to
 * call, and the browser only posts to /api/chat. Keep the rules here dumb — the
 * real intent handling does not belong in the browser.
 */
import { SEVERITY_ORDER, type SafetyToolResult, type Severity } from "@safezone/shared";

/** Everything the router needs from the MCP client, so tests can pass a stub. */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<SafetyToolResult>;
}

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

/** A tool result together with the tool that produced it. */
export interface ToolOutcome {
  tool: string;
  result: SafetyToolResult;
}

export interface Turn {
  /** What the assistant says, assembled from the tool summaries. */
  reply: string;
  outcomes: ToolOutcome[];
  severity: Severity;
  place?: Place;
  /** true when this turn moved to a different place, so old factors are stale. */
  placeChanged: boolean;
}

interface FireCluster {
  lat: number;
  lon: number;
  radius_km?: number;
  distance_km: number;
  count: number;
}

export interface RouterState {
  place?: Place;
  fireClusters: FireCluster[];
}

const SAFETY_WORDS = /\b(safe|safety|danger|dangerous|risk|hazard|what'?s happening|around)\b/i;
const WIND_WORDS = /\b(wind|smoke|blow|drift|moving)\b/i;
const FIRE_WORDS = /\b(fire|fires|wildfire|hotspot|burning)\b/i;
const AIR_WORDS = /\b(air|aqi|breathe|breathing|haze)\b/i;
const QUAKE_WORDS = /\b(earthquake|quake|shaking|seismic)\b/i;
const ALERT_WORDS = /\b(alert|alerts|warning|warnings|watch|advisory)\b/i;
const HOSPITAL_WORDS = /\b(hospital|hospitals|emergency room|er)\b/i;
const FIRE_STATION_WORDS = /\b(fire station|fire department)\b/i;
const SHELTER_WORDS = /\b(shelter|shelters|evacuation|assembly point)\b/i;
const PLACE_WORDS = /\b(hospital|shelter|fire station|safe place|where should i go|nearest)\b/i;
const AWAY_WORDS = /\b(away from|avoid|not towards|safe from)\b/i;

/** Pulls a place out of "… in Sacramento?" or "… around Los Angeles". */
export function extractPlace(question: string): string | undefined {
  const match = /\b(?:in|at|around|near|for|about)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})/.exec(
    question,
  );
  return match?.[1]?.replace(/[?.,!]+$/, "").trim();
}

export function worstSeverity(results: SafetyToolResult[]): Severity {
  return results.reduce<Severity>((worst, result) => {
    const severity = result.severity ?? "none";
    return SEVERITY_ORDER[severity] > SEVERITY_ORDER[worst] ? severity : worst;
  }, "none");
}

/**
 * A result that only places the marker: useful on the map, noise when spoken.
 * A result with no layers at all (for example "no active alerts") is a real
 * answer and must not be filtered out.
 */
export const isPlacementOnly = (result: SafetyToolResult): boolean => {
  const layers = result.map?.layers ?? [];
  return layers.length > 0 && layers.every((layer) => layer.kind === "home");
};

/** Joins tool summaries into something that reads like one spoken answer. */
function speak(results: SafetyToolResult[]): string {
  const spoken = results.filter((result) => !isPlacementOnly(result));
  // With nothing else to say, the geocode line is the answer.
  return (spoken.length > 0 ? spoken : results)
    .map((result) => result.summary.trim())
    .filter(Boolean)
    .join(" ");
}

export async function ask(
  client: ToolCaller,
  question: string,
  state: RouterState,
): Promise<{ turn: Turn; state: RouterState }> {
  const next: RouterState = { ...state, fireClusters: [...state.fireClusters] };
  const outcomes: ToolOutcome[] = [];
  const previousPlace = state.place;

  // 1. Resolve the place, either from this question or from earlier in the chat.
  const spokenPlace = extractPlace(question);
  if (spokenPlace || !next.place) {
    const geocoded = await client.callTool("geocode", { query: spokenPlace ?? question });
    outcomes.push({ tool: "geocode", result: geocoded });
    next.place = {
      label: String(geocoded.data.label ?? geocoded.data.name ?? spokenPlace ?? question),
      lat: Number(geocoded.data.lat),
      lon: Number(geocoded.data.lon),
    };
  }
  const place = next.place;
  if (!place) throw new Error("I could not work out which place you mean.");
  const point = { lat: place.lat, lon: place.lon };

  // 2. Pick the tools. A general safety question asks everything at once, which
  //    is what assess_risk will do on the server in M5.
  const wantsPlaces = PLACE_WORDS.test(question);
  const narrow =
    !wantsPlaces &&
    (WIND_WORDS.test(question) ||
      FIRE_WORDS.test(question) ||
      AIR_WORDS.test(question) ||
      QUAKE_WORDS.test(question) ||
      ALERT_WORDS.test(question));

  if (wantsPlaces) {
    const type = HOSPITAL_WORDS.test(question)
      ? "hospital"
      : FIRE_STATION_WORDS.test(question)
        ? "fire_station"
        : SHELTER_WORDS.test(question)
          ? "shelter"
          : "any";
    // "away from the fire" → feed the remembered fire clusters in as avoid zones.
    const avoid = AWAY_WORDS.test(question)
      ? next.fireClusters.slice(0, 3).map((cluster) => ({
          lat: cluster.lat,
          lon: cluster.lon,
          radius_km: Math.max(5, cluster.radius_km ?? 5),
        }))
      : undefined;
    outcomes.push({
      tool: "find_safe_places",
      result: await client.callTool("find_safe_places", {
        ...point,
        type,
        radius_km: 25,
        ...(avoid && avoid.length > 0 ? { avoid } : {}),
      }),
    });
  } else {
    const wanted: { tool: string; args: Record<string, unknown> }[] = [];
    const add = (tool: string, args: Record<string, unknown> = point): void => {
      wanted.push({ tool, args });
    };
    if (narrow) {
      if (FIRE_WORDS.test(question)) {
        add("get_fire_hotspots", { ...point, radius_km: 50, days: 1 });
      }
      if (WIND_WORDS.test(question)) add("get_wind");
      if (AIR_WORDS.test(question)) add("get_air_quality");
      if (QUAKE_WORDS.test(question)) add("get_earthquakes");
      if (ALERT_WORDS.test(question)) add("get_weather_alerts");
    } else if (SAFETY_WORDS.test(question) || outcomes.length === 1) {
      // Everything at once, which is what assess_risk will do server-side in M5.
      add("get_fire_hotspots", { ...point, radius_km: 50, days: 1 });
      add("get_weather_alerts");
      add("get_air_quality");
      add("get_wind");
    }
    // Settled, so one dead source does not sink the whole answer.
    const settled = await Promise.allSettled(
      wanted.map((call) => client.callTool(call.tool, call.args)),
    );
    settled.forEach((outcome, index) => {
      const call = wanted[index];
      if (!call) return;
      if (outcome.status === "fulfilled") outcomes.push({ tool: call.tool, result: outcome.value });
      else console.warn(`[router] ${call.tool} failed`, outcome.reason);
    });
  }

  // 3. Remember fire clusters for a later "away from the fire" question.
  const fires = outcomes.find((outcome) => outcome.tool === "get_fire_hotspots");
  const clusters = fires?.result.data.clusters;
  if (Array.isArray(clusters)) next.fireClusters = clusters as FireCluster[];

  const results = outcomes.map((outcome) => outcome.result);
  const spoken = speak(results);
  return {
    turn: {
      reply: spoken || "I could not find anything to report for that place.",
      outcomes,
      severity: worstSeverity(results),
      place,
      placeChanged: previousPlace?.label !== place.label,
    },
    state: next,
  };
}

/** The three scripted questions from SPEC section 2, used for the video and by judges. */
export const PRESETS = [
  "Is it safe around my home in Sacramento?",
  "How is the wind moving?",
  "Where's the nearest hospital away from the fire?",
] as const;
