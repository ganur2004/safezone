import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bearingDeg, destination, haversineKm } from "@safezone/shared";
import { buildOverpassQuery, parseOverpassPlaces, type OsmPlace } from "../src/sources/overpass.js";
import { DANGER_PENALTY_KM, placesSummary, rankPlaces } from "../src/tools/places.js";

const sacramento = { lat: 38.5816, lon: -121.4944 };

const fixture = (name: string): Parameters<typeof parseOverpassPlaces>[0] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/places", name), "utf8"));

const recorded = parseOverpassPlaces(fixture("sacramento-fires.json"), sacramento);

describe("buildOverpassQuery", () => {
  it("asks for nodes and ways so hospitals mapped as polygons are found", () => {
    const query = buildOverpassQuery(sacramento, 25, "hospital");
    expect(query).toContain('node["amenity"="hospital"](around:25000,38.58160,-121.49440);');
    expect(query).toContain('way["amenity"="hospital"](around:25000,38.58160,-121.49440);');
    expect(query).toContain("out center tags");
  });

  it("covers every place type for 'any'", () => {
    const query = buildOverpassQuery(sacramento, 25, "any");
    expect(query).toContain('"amenity"="hospital"');
    expect(query).toContain('"amenity"="fire_station"');
    expect(query).toContain('"emergency"="assembly_point"');
    expect(query).toContain('"social_facility"="shelter"');
  });
});

describe("parseOverpassPlaces", () => {
  it("reads the recorded Sacramento area, nearest first", () => {
    expect(recorded.length).toBeGreaterThan(5);
    const distances = recorded.map((place) => place.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(recorded.every((place) => place.name.length > 0)).toBe(true);
    expect(new Set(recorded.map((place) => place.type))).toContain("hospital");
  });

  it("takes the centre of a way and names unnamed features by type", () => {
    const parsed = parseOverpassPlaces(
      {
        elements: [
          { type: "way", id: 1, center: { lat: 38.6, lon: -121.5 }, tags: { amenity: "hospital" } },
          {
            type: "node",
            id: 2,
            lat: 38.59,
            lon: -121.49,
            tags: { amenity: "fire_station", name: "Station 5" },
          },
          { type: "node", id: 3, lat: 38.6, lon: -121.5, tags: { amenity: "cafe" } },
        ],
      },
      sacramento,
    );
    expect(parsed).toHaveLength(2); // the cafe is not a safe place
    const hospital = parsed.find((place) => place.type === "hospital");
    expect(hospital?.id).toBe("way/1");
    expect(hospital?.name).toBe("Unnamed hospital");
    expect(parsed.find((place) => place.type === "fire_station")?.name).toBe("Station 5");
  });
});

describe("rankPlaces with avoid zones", () => {
  const fire = destination(sacramento, 45, 18); // 18 km north-east
  const place = (name: string, bearing: number, distanceKm: number): OsmPlace => {
    const point = destination(sacramento, bearing, distanceKm);
    return {
      id: name,
      name,
      type: "hospital",
      lat: point.lat,
      lon: point.lon,
      distanceKm: haversineKm(sacramento, point),
    };
  };

  it("keeps the nearest place first when nothing is avoided", () => {
    const ranked = rankPlaces(sacramento, [place("far", 225, 12), place("near", 45, 4)]);
    expect(ranked.map((entry) => entry.name)).toEqual(["near", "far"]);
  });

  it("drops places inside an avoid zone", () => {
    const ranked = rankPlaces(
      sacramento,
      [place("in the fire", 45, 18), place("safe", 225, 9)],
      [{ ...fire, radiusKm: 5 }],
    );
    expect(ranked.map((entry) => entry.name)).toEqual(["safe"]);
  });

  it("prefers a slightly further place over one towards the fire", () => {
    const ranked = rankPlaces(
      sacramento,
      [place("towards fire", 45, 6), place("away from fire", 225, 11)],
      [{ ...fire, radiusKm: 5 }],
    );
    expect(ranked[0]?.name).toBe("away from fire");
    expect(ranked[0]?.towardsDanger).toBe(false);
    expect(ranked[1]?.towardsDanger).toBe(true);
  });

  it("still returns a place towards the fire when it is the only option", () => {
    const ranked = rankPlaces(sacramento, [place("only one", 45, 8)], [{ ...fire, radiusKm: 5 }]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.towardsDanger).toBe(true);
  });

  it("does not penalise a place outside the danger cone", () => {
    const ranked = rankPlaces(
      sacramento,
      [place("perpendicular", 135, 5)],
      [{ ...fire, radiusKm: 5 }],
    );
    expect(ranked[0]?.towardsDanger).toBe(false);
    expect(bearingDeg(sacramento, ranked[0]!)).toBeCloseTo(135, 0);
  });

  it("returns at most five places", () => {
    const many = Array.from({ length: 12 }, (_, index) => place(`p${index}`, 0, index + 1));
    expect(rankPlaces(sacramento, many)).toHaveLength(5);
  });

  it("uses a penalty large enough to matter but not to hide close options", () => {
    expect(DANGER_PENALTY_KM).toBeGreaterThan(5);
    expect(DANGER_PENALTY_KM).toBeLessThan(50);
  });
});

describe("placesSummary", () => {
  it("says so when nothing was found", () => {
    expect(placesSummary([], "hospital", 25, 0)).toMatch(/could not find a hospital/);
  });

  it("names the nearest place with both units and its direction", () => {
    const ranked = rankPlaces(sacramento, recorded);
    const summary = placesSummary(ranked, "any", 25, 0);
    expect(summary).toContain(ranked[0]!.name);
    expect(summary).toMatch(/\d+(\.\d)? km \(\d+(\.\d)? mi\)/);
  });

  it("mentions avoiding the hazard when zones were given", () => {
    const ranked = rankPlaces(sacramento, recorded, [
      { ...destination(sacramento, 45, 18), radiusKm: 5 },
    ]);
    expect(placesSummary(ranked, "hospital", 25, 1)).toContain("away from the hazard");
  });
});
