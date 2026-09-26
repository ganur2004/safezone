/**
 * Pure logic for `find_safe_places` (spec 5.3), including the `avoid` parameter
 * that answers "where's the nearest hospital away from the fire?".
 */
import {
  angleDiff,
  bearingDeg,
  formatKmAndMiles,
  haversineKm,
  spellDirection,
  toCardinal,
  type CardinalDirection,
  type LatLon,
} from "@safezone/shared";
import type { OsmPlace, SafePlaceType } from "../sources/overpass.js";

export interface AvoidZone extends LatLon {
  radiusKm: number;
}

export interface RankedPlace extends OsmPlace {
  bearingDeg: number;
  direction: CardinalDirection;
  /** true when the place sits roughly in the direction of a zone to avoid. */
  towardsDanger: boolean;
}

/** A place counts as "towards the danger" within this angle of the zone's bearing. */
export const DANGER_CONE_DEG = 45;
/** Effective kilometres added when ranking a place that lies towards the danger. */
export const DANGER_PENALTY_KM = 20;

/**
 * Drops places inside an avoid zone, then ranks by distance with a penalty for
 * places that lie in the direction of the danger, so "away from the fire" wins
 * even if it is a little further.
 */
export function rankPlaces(
  origin: LatLon,
  places: OsmPlace[],
  avoid: AvoidZone[] = [],
  limit = 5,
): RankedPlace[] {
  return places
    .filter((place) => !avoid.some((zone) => haversineKm(zone, place) <= zone.radiusKm))
    .map((place) => {
      const bearing = bearingDeg(origin, place);
      const towardsDanger = avoid.some(
        (zone) => angleDiff(bearing, bearingDeg(origin, zone)) <= DANGER_CONE_DEG,
      );
      return {
        ...place,
        bearingDeg: Math.round(bearing),
        direction: toCardinal(bearing),
        towardsDanger,
      };
    })
    .sort(
      (a, b) =>
        a.distanceKm +
        (a.towardsDanger ? DANGER_PENALTY_KM : 0) -
        (b.distanceKm + (b.towardsDanger ? DANGER_PENALTY_KM : 0)),
    )
    .slice(0, limit);
}

const TYPE_WORDS: Record<SafePlaceType, string> = {
  hospital: "hospital",
  fire_station: "fire station",
  shelter: "shelter",
  any: "safe place",
};

export function placesSummary(
  places: RankedPlace[],
  type: SafePlaceType,
  radiusKm: number,
  avoidCount: number,
): string {
  const word = TYPE_WORDS[type];
  if (places.length === 0) {
    return `I could not find a ${word} within ${formatKmAndMiles(radiusKm)} of that location.`;
  }
  const nearest = places[0] as RankedPlace;
  const kind = type === "any" ? TYPE_WORDS[nearest.type] : word;
  const awayNote = avoidCount > 0 ? ", away from the hazard" : "";
  const more = places.length > 1 ? ` I found ${places.length} options in total.` : "";
  return (
    `The nearest ${kind} is ${nearest.name}, ${formatKmAndMiles(nearest.distanceKm)} ` +
    `to the ${spellDirection(nearest.direction)}${awayNote}.${more}`
  );
}
