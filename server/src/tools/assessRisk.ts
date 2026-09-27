/**
 * MCP tool `assess_risk` — the main one (SPEC 5.3, 6).
 *
 * Calls the narrow tools in parallel, applies the rule set, and returns one
 * answer with every map layer. A source that fails is left out rather than
 * failing the whole assessment (SPEC 5.6).
 */
import { z } from "zod";
import { haversineKm } from "@safezone/shared";
import type { LatLon, MapLayer, SafetyToolResult, SourceRef } from "@safezone/shared";
import { bboxOfPoints } from "../lib/geojson.js";
import { ToolInputError } from "../lib/errors.js";
import { assessRisk as applyRules, riskSummary } from "../risk/rules.js";
import { toRiskInputs, type SourceResults } from "../risk/inputs.js";
import { geocodeTool } from "./geocode.js";
import { getAirQualityTool } from "./getAirQuality.js";
import { getEarthquakesTool } from "./getEarthquakes.js";
import { getFireHotspotsTool } from "./getFireHotspots.js";
import { getWeatherAlertsTool } from "./getWeatherAlerts.js";
import { getWindTool } from "./getWind.js";
import { defineTool } from "./registry.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).optional().describe("Latitude, if you already have it."),
  lon: z.number().min(-180).max(180).optional().describe("Longitude, if you already have it."),
  place: z
    .string()
    .min(2)
    .max(200)
    .optional()
    .describe("A place name instead of coordinates, for example 'Sacramento'."),
  radius_km: z
    .number()
    .min(1)
    .max(300)
    .default(50)
    .describe("How far around the point to look for hazards. Defaults to 50."),
};

export const assessRiskTool = defineTool({
  name: "assess_risk",
  title: "Overall safety assessment",
  description:
    "Checks every hazard around a place at once — wildfires, official weather alerts, air quality, " +
    "wind and earthquakes — and returns an overall risk level with the reasons and what to do. " +
    "Use this first when the user asks whether a place is safe or what dangers are nearby. " +
    "Accepts either coordinates or a place name.",
  inputSchema,
  async handler({ lat, lon, place, radius_km: radiusKm }): Promise<SafetyToolResult> {
    const { point, label, geocoded } = await resolvePoint({ lat, lon, place });

    // Everything in parallel; settled so one dead source cannot sink the answer.
    const [fires, alerts, air, wind, quakes] = await Promise.allSettled([
      getFireHotspotsTool.handler({ ...point, radius_km: radiusKm, days: 1 }),
      getWeatherAlertsTool.handler(point),
      getAirQualityTool.handler(point),
      getWindTool.handler(point),
      getEarthquakesTool.handler({ ...point, radius_km: 200, days: 3, min_magnitude: 2.5 }),
    ]);

    const results: SourceResults = {
      ...valueOf("fires", fires),
      ...valueOf("alerts", alerts),
      ...valueOf("air", air),
      ...valueOf("wind", wind),
      ...valueOf("quakes", quakes),
    };
    const gathered = Object.values(results);
    const unavailable = [
      fires.status === "rejected" ? "fire data" : undefined,
      alerts.status === "rejected" ? "official alerts" : undefined,
      air.status === "rejected" ? "air quality" : undefined,
      wind.status === "rejected" ? "wind" : undefined,
      quakes.status === "rejected" ? "earthquake data" : undefined,
    ].filter((name): name is string => name !== undefined);

    const assessment = applyRules(toRiskInputs(results));

    const layers: MapLayer[] = [
      ...(geocoded?.map?.layers ?? []),
      ...gathered.flatMap((result) => result.map?.layers ?? []),
    ];

    return {
      summary: withCaveat(riskSummary(assessment, label), unavailable),
      severity: assessment.severity,
      map: { view: viewFor(point, layers, radiusKm), layers: dedupeLayers(layers) },
      data: {
        place: label ?? null,
        lat: point.lat,
        lon: point.lon,
        radius_km: radiusKm,
        level: assessment.severity,
        escalated: assessment.escalated,
        factors: assessment.factors,
        recommendations: assessment.recommendations,
        // Which sources answered, so the panel can be honest about coverage.
        sources_checked: Object.keys(results),
        sources_unavailable: unavailable,
      },
      sources: dedupeSources([geocoded, ...gathered]),
      ...(gathered.some((result) => result.demo) ? { demo: true } : {}),
    };
  },
});

/** Accepts coordinates or a place name; the name is geocoded here (SPEC 5.3). */
async function resolvePoint(input: { lat?: number; lon?: number; place?: string }): Promise<{
  point: LatLon;
  label?: string;
  geocoded?: SafetyToolResult;
}> {
  if (input.lat !== undefined && input.lon !== undefined) {
    return { point: { lat: input.lat, lon: input.lon } };
  }
  if (!input.place) {
    throw new ToolInputError("Tell me a place name, or give me a latitude and longitude.");
  }
  const geocoded = await geocodeTool.handler({ query: input.place });
  const lat = Number(geocoded.data.lat);
  const lon = Number(geocoded.data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ToolInputError(`I could not find a place called "${input.place}".`);
  }
  return {
    point: { lat, lon },
    label: String(geocoded.data.label ?? geocoded.data.name ?? input.place),
    geocoded,
  };
}

const valueOf = <K extends keyof SourceResults>(
  key: K,
  outcome: PromiseSettledResult<SafetyToolResult>,
): Partial<SourceResults> => (outcome.status === "fulfilled" ? { [key]: outcome.value } : {});

/** Mentions gaps in coverage rather than quietly assessing on partial data (SPEC 5.6). */
function withCaveat(summary: string, unavailable: string[]): string {
  if (unavailable.length === 0) return summary;
  return `${summary} (${unavailable.join(" and ")} temporarily unavailable)`;
}

/** Later layers win, so a source that ran twice does not draw twice. */
function dedupeLayers(layers: MapLayer[]): MapLayer[] {
  const byId = new Map<string, MapLayer>();
  for (const layer of layers) byId.set(layer.id, layer);
  return [...byId.values()];
}

function dedupeSources(results: (SafetyToolResult | undefined)[]): SourceRef[] {
  const byName = new Map<string, SourceRef>();
  for (const result of results) {
    for (const source of result?.sources ?? []) {
      if (!byName.has(source.name)) byName.set(source.name, source);
    }
  }
  return [...byName.values()];
}

/**
 * A view wide enough for everything that matters (SPEC 5.3), but no wider.
 *
 * Only point layers steer it — an alert polygon can span a whole state — and
 * only points inside the requested radius, so one minor earthquake 180 km away
 * cannot push the place the user asked about off the screen.
 */
function viewFor(point: LatLon, layers: MapLayer[], radiusKm: number) {
  const points: LatLon[] = [point];
  for (const layer of layers) {
    if (layer.kind !== "fires" && layer.kind !== "places" && layer.kind !== "quakes") continue;
    for (const feature of layer.geojson.features) {
      const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } })
        .geometry;
      if (geometry?.type !== "Point") continue;
      const [lon, lat] = geometry.coordinates as [number, number];
      const candidate = { lat, lon };
      if (haversineKm(point, candidate) <= radiusKm) points.push(candidate);
    }
  }
  const bbox = bboxOfPoints(points);
  return bbox ? { bbox } : { center: [point.lon, point.lat] as [number, number], zoom: 9 };
}
