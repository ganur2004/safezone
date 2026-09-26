/** Pure logic for `get_earthquakes` (spec 5.3). */
import { formatKmAndMiles } from "@safezone/shared";
import type { Severity } from "@safezone/shared";
import type { Quake } from "../sources/usgs.js";

/** Spec 6.1: M≥6.0 within 100 km in the last 24h is high, M≥5.0 moderate. */
export function quakeSeverity(quakes: Quake[], now = Date.now()): Severity {
  const recentNearby = quakes.filter(
    (quake) => quake.distanceKm <= 100 && now - quake.time <= 24 * 60 * 60 * 1000,
  );
  const strongest = Math.max(0, ...recentNearby.map((quake) => quake.magnitude));
  if (strongest >= 6) return "high";
  if (strongest >= 5) return "moderate";
  return quakes.length > 0 ? "low" : "none";
}

export function quakesSummary(quakes: Quake[], radiusKm: number, days: number): string {
  const window = days === 1 ? "the last 24 hours" : `the last ${days} days`;
  if (quakes.length === 0) {
    return `No earthquakes were recorded within ${formatKmAndMiles(radiusKm)} in ${window}.`;
  }
  const strongest = quakes[0] as Quake;
  const plural = quakes.length === 1 ? "earthquake" : "earthquakes";
  return (
    `${quakes.length} ${plural} recorded within ${formatKmAndMiles(radiusKm)} in ${window}. ` +
    `The strongest was magnitude ${strongest.magnitude.toFixed(1)}, ` +
    `${formatKmAndMiles(strongest.distanceKm)} away.`
  );
}
