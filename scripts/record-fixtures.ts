/**
 * Records real API responses into server/fixtures for DEMO_MODE (spec 5.5).
 *
 * Everything except NASA FIRMS is keyless. FIRMS needs FIRMS_MAP_KEY; without it
 * the existing fire CSVs are kept and the rest is still refreshed.
 *
 * Usage: npm run record-fixtures
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const fixturesDir = resolve(import.meta.dirname, "../server/fixtures");
const mapKey = process.env.FIRMS_MAP_KEY?.trim();
const nwsUserAgent = process.env.NWS_USER_AGENT?.trim() || "SafeZone (safezone@example.com)";

interface Scenario {
  id: string;
  label: string;
  lat: number;
  lon: number;
  fires?: string;
  alerts?: string;
  aliases?: string[];
  quakes?: string;
  air?: string;
  geocode?: string;
  wind?: string;
  places?: string;
}

const FIRE_RADIUS_KM = 60;
const QUAKE_RADIUS_KM = 200;
const QUAKE_DAYS = 3;
const PLACES_RADIUS_KM = 30;
const EARTH_RADIUS_KM = 6371.0088;

const bbox = (lat: number, lon: number, radiusKm: number): string => {
  const latDelta = ((radiusKm / EARTH_RADIUS_KM) * 180) / Math.PI;
  const lonDelta = latDelta / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta]
    .map((value) => value.toFixed(4))
    .join(",");
};

const { scenarios } = JSON.parse(
  await readFile(resolve(fixturesDir, "scenarios.json"), "utf8"),
) as { scenarios: Scenario[] };

async function readIfExists(relativePath: string | undefined): Promise<string | undefined> {
  if (!relativePath) return undefined;
  try {
    return await readFile(resolve(fixturesDir, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

async function save(relativePath: string, body: string): Promise<void> {
  const target = resolve(fixturesDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
}

/** Fetches a URL and writes the body, keeping the previous fixture on failure. */
async function record(
  label: string,
  relativePath: string | undefined,
  url: string,
  init: RequestInit & { expect?: RegExp } = {},
): Promise<void> {
  if (!relativePath) return;
  const { expect, ...requestInit } = init;
  try {
    const response = await fetch(url, requestInit);
    const text = await response.text();
    if (!response.ok || (expect && !expect.test(text))) {
      console.error(`  ${label}: HTTP ${response.status}, keeping the existing fixture`);
      return;
    }
    // Reformat JSON so the fixtures stay readable in review.
    const body = relativePath.endsWith(".json")
      ? `${JSON.stringify(JSON.parse(text), null, 1)}\n`
      : text;
    await save(relativePath, body);
    console.log(`  ${label}: ${(body.length / 1024).toFixed(1)} kB → ${relativePath}`);
  } catch (error) {
    console.error(`  ${label}: ${(error as Error).message}, keeping the existing fixture`);
  }
}

const overpassQuery = (lat: number, lon: number): string => {
  const around = `(around:${PLACES_RADIUS_KM * 1000},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const filters = [
    '["amenity"="hospital"]',
    '["amenity"="fire_station"]',
    '["emergency"="assembly_point"]',
    '["social_facility"="shelter"]',
  ];
  const clauses = filters
    .flatMap((filter) => [`node${filter}${around};`, `way${filter}${around};`])
    .join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout center tags 120;`;
};

for (const scenario of scenarios) {
  console.log(`${scenario.id} (${scenario.label})`);

  if (mapKey) {
    await record(
      "fires",
      scenario.fires,
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/` +
        `${bbox(scenario.lat, scenario.lon, FIRE_RADIUS_KM)}/1`,
      { expect: /latitude/i },
    );
  } else {
    console.log("  fires: FIRMS_MAP_KEY not set, keeping the existing CSV");
  }

  await record(
    "alerts",
    scenario.alerts,
    `https://api.weather.gov/alerts/active?point=${scenario.lat.toFixed(4)},` +
      `${scenario.lon.toFixed(4)}&status=actual`,
    { headers: { "user-agent": nwsUserAgent, accept: "application/geo+json" } },
  );

  // The query the demo simulator would send for this scenario.
  await record(
    "geocode",
    scenario.geocode,
    "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(scenario.aliases?.[0] ?? scenario.label)}` +
      "&count=1&language=en&format=json",
  );

  const start = new Date(Date.now() - QUAKE_DAYS * 86400000).toISOString();
  await record(
    "quakes",
    scenario.quakes,
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
      `&latitude=${scenario.lat}&longitude=${scenario.lon}&maxradiuskm=${QUAKE_RADIUS_KM}` +
      `&starttime=${start}&minmagnitude=2.5&orderby=time`,
  );

  await record(
    "air",
    scenario.air,
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
      `?latitude=${scenario.lat}&longitude=${scenario.lon}&current=us_aqi,pm2_5,pm10`,
  );

  await record(
    "wind",
    scenario.wind,
    "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${scenario.lat}&longitude=${scenario.lon}` +
      "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh",
  );

  // Public Overpass instances answer 504 when busy, so try the mirrors in turn.
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    const before = await readIfExists(scenario.places);
    await record("places", scenario.places, endpoint, {
      method: "POST",
      // Overpass answers 406 for a User-Agent with an email in parentheses.
      headers: {
        "user-agent": "SafeZone/0.1",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: overpassQuery(scenario.lat, scenario.lon) }),
      expect: /"elements"/,
    });
    if ((await readIfExists(scenario.places)) !== before) break;
  }
}

console.log("\nDone. Review the diff before committing recorded data.");
