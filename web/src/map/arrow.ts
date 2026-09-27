/**
 * Builds a triangular arrowhead for the wind layer.
 *
 * MapLibre can only draw an arrow glyph if the style ships the sprite or font for
 * it, so the head is computed here as a polygon instead — no asset dependency and
 * it scales with the line itself.
 */
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

function destination(
  [lon, lat]: [number, number],
  bearing: number,
  distanceKm: number,
): [number, number] {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearing);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)];
}

function bearing([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Adds an arrowhead polygon at the end of every LineString in the collection. */
export function withArrowHeads(collection: FeatureCollection): FeatureCollection {
  const heads: Feature<Polygon>[] = [];
  for (const feature of collection.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const coordinates = (feature.geometry as LineString).coordinates as [number, number][];
    const tip = coordinates.at(-1);
    const previous = coordinates.at(-2);
    if (!tip || !previous) continue;

    const heading = bearing(previous, tip);
    /*
     * The head is measured in kilometres like the shaft, so it has to stay
     * proportional to it: a fixed minimum looked fine over a whole county and
     * covered half a city when the map flew in close. 15% of the shaft reads as
     * an arrowhead at every zoom the simulator uses.
     */
    const size = Math.min(2, distanceKm(previous, tip) * 0.15);
    heads.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [tip, destination(tip, heading + 150, size), destination(tip, heading - 150, size), tip],
        ],
      },
      properties: { ...feature.properties, arrowhead: true },
    });
  }
  return heads.length === 0
    ? collection
    : { ...collection, features: [...collection.features, ...heads] };
}
