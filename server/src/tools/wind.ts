/**
 * Pure logic for `get_wind` (spec 5.3).
 *
 * The meteorological convention is the trap here: APIs report where the wind
 * comes FROM. 270° means a west wind, blowing TOWARDS the east. We expose both
 * `from_deg` and `to_deg` so nothing downstream has to remember that (spec 6.2).
 */
import {
  destination,
  spellDirection,
  toCardinal,
  type CardinalDirection,
  type LatLon,
} from "@safezone/shared";
import type { Feature, LineString } from "geojson";

export const windToDeg = (fromDeg: number): number => (fromDeg + 180) % 360;

export interface WindDescription {
  speedKmh: number;
  gustsKmh: number | undefined;
  fromDeg: number;
  toDeg: number;
  fromDirection: CardinalDirection;
  toDirection: CardinalDirection;
}

export function describeWind(
  speedKmh: number,
  fromDeg: number,
  gustsKmh?: number,
): WindDescription {
  const toDeg = windToDeg(fromDeg);
  return {
    speedKmh,
    gustsKmh,
    fromDeg,
    toDeg,
    fromDirection: toCardinal(fromDeg),
    toDirection: toCardinal(toDeg),
  };
}

/**
 * Arrow from the point along `to_deg`, length scaled by speed
 * (2 km per km/h, clamped) so the map shows where smoke will drift.
 */
export function windArrow(point: LatLon, wind: WindDescription): Feature<LineString> {
  const lengthKm = Math.min(30, Math.max(3, wind.speedKmh * 0.6));
  const tip = destination(point, wind.toDeg, lengthKm);
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [point.lon, point.lat],
        [tip.lon, tip.lat],
      ],
    },
    properties: {
      speed_kmh: wind.speedKmh,
      gusts_kmh: wind.gustsKmh ?? null,
      from_deg: wind.fromDeg,
      to_deg: wind.toDeg,
      from_direction: wind.fromDirection,
      to_direction: wind.toDirection,
      length_km: Math.round(lengthKm),
    },
  };
}

const MPH_PER_KMH = 0.621371;

export function windSummary(wind: WindDescription | undefined): string {
  if (!wind) return "Wind data is temporarily unavailable for this location.";
  const mph = Math.round(wind.speedKmh * MPH_PER_KMH);
  if (wind.speedKmh < 2) {
    return `The air is nearly calm, about ${Math.round(wind.speedKmh)} km/h (${mph} mph).`;
  }
  const gusts =
    wind.gustsKmh !== undefined && wind.gustsKmh > wind.speedKmh + 5
      ? ` Gusts reach ${Math.round(wind.gustsKmh)} km/h (${Math.round(wind.gustsKmh * MPH_PER_KMH)} mph).`
      : "";
  return (
    `The wind is from the ${spellDirection(wind.fromDirection)} at ${Math.round(wind.speedKmh)} km/h ` +
    `(${mph} mph), blowing towards the ${spellDirection(wind.toDirection)}.${gusts}`
  );
}
