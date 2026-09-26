/**
 * Pure logic behind `get_fire_hotspots` (spec 5.3): filter, cluster, describe.
 * Kept free of I/O so it can be unit-tested on fixtures.
 */
import {
  bearingDeg,
  formatKmAndMiles,
  haversineKm,
  spellDirection,
  toCardinal,
  type CardinalDirection,
  type LatLon,
} from "@safezone/shared";
import type { FirmsHotspot } from "../sources/firms.js";

/** Hotspots closer than this to each other are merged into one cluster (spec 5.3). */
export const CLUSTER_RADIUS_KM = 2;

export interface Hotspot extends LatLon {
  frp: number;
  confidence: string;
  acquiredAt: string;
  distanceKm: number;
  bearingDeg: number;
  direction: CardinalDirection;
}

export interface FireCluster extends LatLon {
  count: number;
  /** Summed fire radiative power, a rough proxy for intensity. */
  frp: number;
  distanceKm: number;
  bearingDeg: number;
  direction: CardinalDirection;
}

/**
 * Drops low-confidence detections and hotspots outside the true radius
 * (the FIRMS query is a bbox, so its corners reach beyond the circle).
 */
export function filterHotspots(
  origin: LatLon,
  hotspots: FirmsHotspot[],
  radiusKm: number,
): Hotspot[] {
  return hotspots
    .filter((hotspot) => hotspot.confidence !== "l" && hotspot.confidence !== "low")
    .map((hotspot) => {
      const point: LatLon = { lat: hotspot.lat, lon: hotspot.lon };
      const bearing = bearingDeg(origin, point);
      return {
        ...point,
        frp: hotspot.frp,
        confidence: hotspot.confidence,
        acquiredAt: hotspot.acquiredAt,
        distanceKm: haversineKm(origin, point),
        bearingDeg: Math.round(bearing),
        direction: toCardinal(bearing),
      };
    })
    .filter((hotspot) => hotspot.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Greedy single-pass clustering: strongest hotspot first, everything within
 * CLUSTER_RADIUS_KM of a cluster seed joins it. Good enough to avoid saying
 * "214 hotspots" out loud, and deterministic for tests.
 */
export function clusterHotspots(
  origin: LatLon,
  hotspots: Hotspot[],
  radiusKm = CLUSTER_RADIUS_KM,
): FireCluster[] {
  const seeds = [...hotspots].sort((a, b) => b.frp - a.frp || a.distanceKm - b.distanceKm);
  const groups: Hotspot[][] = [];
  for (const hotspot of seeds) {
    const group = groups.find((candidate) => {
      const seed = candidate[0] as Hotspot;
      return haversineKm(seed, hotspot) <= radiusKm;
    });
    if (group) group.push(hotspot);
    else groups.push([hotspot]);
  }
  return groups
    .map((group) => {
      const lat = average(group.map((hotspot) => hotspot.lat));
      const lon = average(group.map((hotspot) => hotspot.lon));
      const center: LatLon = { lat, lon };
      const bearing = bearingDeg(origin, center);
      return {
        lat,
        lon,
        count: group.length,
        frp: round(
          group.reduce((total, hotspot) => total + hotspot.frp, 0),
          1,
        ),
        distanceKm: round(haversineKm(origin, center), 1),
        bearingDeg: Math.round(bearing),
        direction: toCardinal(bearing),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

const average = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Spoken summary, max two sentences, both units, no coordinates (spec 5.2). */
export function fireSummary(
  hotspots: Hotspot[],
  clusters: FireCluster[],
  radiusKm: number,
  days: number,
): string {
  const window = days === 1 ? "the last 24 hours" : `the last ${days} days`;
  if (hotspots.length === 0) {
    return `No active fire hotspots detected within ${formatKmAndMiles(radiusKm)} in ${window}.`;
  }
  const closest = hotspots[0] as Hotspot;
  const clusterNote =
    clusters.length > 1
      ? ` in ${clusters.length} separate clusters`
      : clusters.length === 1
        ? " in one cluster"
        : "";
  const plural = hotspots.length === 1 ? "hotspot" : "hotspots";
  return (
    `${hotspots.length} active fire ${plural}${clusterNote} within ${formatKmAndMiles(radiusKm)}. ` +
    `The closest is ${formatKmAndMiles(closest.distanceKm)} ${spellDirection(closest.direction)}.`
  );
}
