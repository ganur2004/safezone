/**
 * Records real API responses into server/fixtures for DEMO_MODE (spec 5.5).
 * Needs FIRMS_MAP_KEY. Usage: node --experimental-strip-types scripts/record-fixtures.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixturesDir = resolve(import.meta.dirname, "../server/fixtures");
const mapKey = process.env.FIRMS_MAP_KEY?.trim();

if (!mapKey) {
  console.error("FIRMS_MAP_KEY is not set — get a free key at");
  console.error("https://firms.modaps.eosdis.nasa.gov/api/map_key/");
  process.exit(1);
}

interface Scenario {
  id: string;
  label: string;
  lat: number;
  lon: number;
  fires?: string;
}

const RADIUS_KM = 60;
const DAYS = 1;
const EARTH_RADIUS_KM = 6371.0088;

const bbox = (lat: number, lon: number): string => {
  const latDelta = ((RADIUS_KM / EARTH_RADIUS_KM) * 180) / Math.PI;
  const lonDelta = latDelta / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta]
    .map((value) => value.toFixed(4))
    .join(",");
};

const { scenarios } = JSON.parse(
  await readFile(resolve(fixturesDir, "scenarios.json"), "utf8"),
) as { scenarios: Scenario[] };

for (const scenario of scenarios) {
  if (!scenario.fires) continue;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${bbox(
    scenario.lat,
    scenario.lon,
  )}/${DAYS}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok || !/latitude/i.test(text)) {
    console.error(`${scenario.id}: FIRMS returned HTTP ${response.status}, keeping old fixture`);
    continue;
  }
  const rows = text.trim().split(/\r?\n/).length - 1;
  await writeFile(resolve(fixturesDir, scenario.fires), text);
  console.log(`${scenario.id}: recorded ${rows} hotspots → ${scenario.fires}`);
}
