/**
 * Turns the other tools' `data` payloads into the typed inputs the rules expect
 * (SPEC 6). Kept separate and pure so the mapping is testable, and so a change
 * to a tool's output shape breaks here rather than silently downgrading a risk.
 */
import type { SafetyToolResult } from "@safezone/shared";
import type { AlertInput, FireInput, QuakeInput, RiskInputs, WindInput } from "./rules.js";

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

export function fireInput(result: SafetyToolResult | undefined): FireInput | undefined {
  if (!result) return undefined;
  const count = asNumber(result.data.count) ?? 0;
  const radiusKm = asNumber(result.data.radius_km) ?? 50;
  const closest = asRecord(result.data.closest);
  if (count === 0 || !closest)
    return {
      count,
      closestDistanceKm: Infinity,
      closestBearingDeg: 0,
      closestDirection: "",
      radiusKm,
    };
  return {
    count,
    closestDistanceKm: asNumber(closest.distance_km) ?? Infinity,
    closestBearingDeg: asNumber(closest.bearing_deg) ?? 0,
    closestDirection: asString(closest.direction_spoken) ?? asString(closest.direction) ?? "",
    radiusKm,
  };
}

export function windInput(result: SafetyToolResult | undefined): WindInput | undefined {
  const speedKmh = asNumber(result?.data.speed_kmh);
  const fromDeg = asNumber(result?.data.from_deg);
  if (speedKmh === undefined || fromDeg === undefined) return undefined;
  return { speedKmh, fromDeg };
}

export function alertInputs(result: SafetyToolResult | undefined): AlertInput[] {
  const alerts = result?.data.alerts;
  if (!Array.isArray(alerts)) return [];
  return alerts.flatMap((candidate) => {
    const alert = asRecord(candidate);
    const severity = asString(alert?.severity);
    const event = asString(alert?.event);
    if (!alert || !event || !severity) return [];
    const instruction = asString(alert.instruction);
    return [
      {
        event,
        severity: severity as AlertInput["severity"],
        ...(instruction ? { instruction: firstSentence(instruction) } : {}),
      },
    ];
  });
}

export function quakeInputs(result: SafetyToolResult | undefined): QuakeInput[] {
  // The earthquake tool reports only the strongest quake in `data`; the layer
  // carries them all, which is what the "within 100 km in the last day" rule needs.
  const features = result?.map?.layers.find((layer) => layer.kind === "quakes")?.geojson.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    const properties = asRecord((feature as { properties?: unknown }).properties);
    const magnitude = asNumber(properties?.magnitude);
    const distanceKm = asNumber(properties?.distance_km);
    const time = asString(properties?.time);
    if (magnitude === undefined || distanceKm === undefined || !time) return [];
    const parsed = Date.parse(time);
    if (Number.isNaN(parsed)) return [];
    return [{ magnitude, distanceKm, time: parsed }];
  });
}

export const aqiInput = (result: SafetyToolResult | undefined): number | undefined =>
  asNumber(result?.data.us_aqi);

/** Keeps a spoken recommendation to one sentence (SPEC 6.3). */
function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentence = cleaned.split(/(?<=\.)\s/)[0] ?? cleaned;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

export interface SourceResults {
  fires?: SafetyToolResult;
  alerts?: SafetyToolResult;
  air?: SafetyToolResult;
  wind?: SafetyToolResult;
  quakes?: SafetyToolResult;
}

/** Collects whatever the sources returned; missing ones simply contribute nothing. */
export function toRiskInputs(results: SourceResults, now?: number): RiskInputs {
  return {
    ...(fireInput(results.fires) ? { fire: fireInput(results.fires) } : {}),
    ...(windInput(results.wind) ? { wind: windInput(results.wind) } : {}),
    alerts: alertInputs(results.alerts),
    ...(aqiInput(results.air) === undefined ? {} : { usAqi: aqiInput(results.air) }),
    quakes: quakeInputs(results.quakes),
    ...(now === undefined ? {} : { now }),
  };
}
