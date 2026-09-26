/**
 * Shared contract between the MCP server, the agent service and the web simulator.
 * See SPEC.md section 5.2.
 */
import { z } from "zod";
import type { FeatureCollection } from "geojson";

export const SEVERITIES = ["none", "low", "moderate", "high", "extreme"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Ordered from least to most dangerous, used to pick the worst factor. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

export const MAP_LAYER_KINDS = [
  "home",
  "fires",
  "alerts",
  "quakes",
  "air",
  "wind",
  "places",
  "route",
  "radius",
] as const;
export type MapLayerKind = (typeof MAP_LAYER_KINDS)[number];

/** Minimal GeoJSON validation: the simulator only needs a FeatureCollection. */
export const geoJsonFeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const mapLayerSchema = z.object({
  /** Unique within one response, e.g. "fires". */
  id: z.string().min(1),
  kind: z.enum(MAP_LAYER_KINDS),
  geojson: geoJsonFeatureCollectionSchema,
});

export const mapViewSchema = z.object({
  /** [lon, lat] */
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().optional(),
  /** [west, south, east, north] */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const sourceRefSchema = z.object({
  name: z.string(),
  url: z.string(),
  fetchedAt: z.string(),
});

export const safetyToolResultSchema = z.object({
  /** 1–2 sentences, English, meant to be spoken. */
  summary: z.string().min(1),
  severity: z.enum(SEVERITIES).optional(),
  map: z
    .object({
      view: mapViewSchema.optional(),
      layers: z.array(mapLayerSchema),
    })
    .optional(),
  data: z.record(z.unknown()),
  sources: z.array(sourceRefSchema),
  /** true when the answer came from recorded fixtures. */
  demo: z.boolean().optional(),
});

export interface MapLayer {
  id: string;
  kind: MapLayerKind;
  geojson: FeatureCollection;
}

export interface MapView {
  center?: [number, number];
  zoom?: number;
  bbox?: [number, number, number, number];
}

export interface SourceRef {
  name: string;
  url: string;
  fetchedAt: string;
}

export interface SafetyToolResult {
  summary: string;
  severity?: Severity;
  map?: { view?: MapView; layers: MapLayer[] };
  data: Record<string, unknown>;
  sources: SourceRef[];
  demo?: boolean;
}

export const CARDINAL_DIRECTIONS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;
export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];
