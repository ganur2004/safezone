/** Helpers that build the GeoJSON the web simulator draws (spec 8.3). */
import { destination, type LatLon } from "@safezone/shared";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";

export function featureCollection(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export function pointFeature(
  point: LatLon,
  properties: Record<string, unknown> = {},
): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties,
  };
}

/** Approximates a circle as a polygon so MapLibre can draw the radius ring. */
export function circleFeature(
  center: LatLon,
  radiusKm: number,
  properties: Record<string, unknown> = {},
  steps = 64,
): Feature<Polygon> {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const { lat, lon } = destination(center, (i / steps) * 360, radiusKm);
    ring.push([lon, lat]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { radius_km: radiusKm, ...properties },
  };
}

/** Bounding box [west, south, east, north] over points, padded by a few km. */
export function bboxOfPoints(
  points: LatLon[],
  paddingKm = 5,
): [number, number, number, number] | undefined {
  if (points.length === 0) return undefined;
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const padLat = paddingKm / 111;
  const padLon = paddingKm / Math.max(1, 111 * Math.cos(((north + south) / 2) * (Math.PI / 180)));
  return [
    Math.max(-180, west - padLon),
    Math.max(-90, south - padLat),
    Math.min(180, east + padLon),
    Math.min(90, north + padLat),
  ];
}
