/** Small geo helpers shared by tools, risk rules and tests. */
import { CARDINAL_DIRECTIONS, type CardinalDirection } from "./types.js";

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from true north (0–360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 0 → "N", 45 → "NE", … (16-point compass). */
export function toCardinal(deg: number): CardinalDirection {
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return CARDINAL_DIRECTIONS[index] as CardinalDirection;
}

/** Bounding box [west, south, east, north] covering a radius around a point. */
export function bboxAround(point: LatLon, radiusKm: number): [number, number, number, number] {
  const latDelta = toDeg(radiusKm / EARTH_RADIUS_KM);
  const cosLat = Math.max(Math.cos(toRad(point.lat)), 1e-6);
  const lonDelta = toDeg(radiusKm / (EARTH_RADIUS_KM * cosLat));
  return [
    clampLon(point.lon - lonDelta),
    clampLat(point.lat - latDelta),
    clampLon(point.lon + lonDelta),
    clampLat(point.lat + latDelta),
  ];
}

/** Destination point given a start, bearing and distance. Used to draw circles and arrows. */
export function destination(point: LatLon, bearing: number, distanceKm: number): LatLon {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearing);
  const lat1 = toRad(point.lat);
  const lon1 = toRad(point.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

export const clampLat = (lat: number): number => Math.max(-90, Math.min(90, lat));
export const clampLon = (lon: number): number => Math.max(-180, Math.min(180, lon));

export const kmToMiles = (km: number): number => km * 0.621371;

/** Rounds to a sensible spoken precision: "18 km", "0.4 km". */
export function roundDistance(km: number): number {
  return km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
}

/** "18 km (11 mi)" — spec 5.2 requires both units. */
export function formatKmAndMiles(km: number): string {
  return `${roundDistance(km)} km (${roundDistance(kmToMiles(km))} mi)`;
}

/** Smallest absolute angle between two bearings, 0–180. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
