/**
 * DEMO_MODE support (spec 5.5): tools read recorded API responses instead of
 * calling the network, so judges can run the project without any keys.
 * When the requested point matches no scenario, the nearest scenario is used.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { haversineKm, type LatLon } from "@safezone/shared";
import { parseFirmsCsv, type FirmsHotspot } from "../sources/firms.js";

const here = dirname(fileURLToPath(import.meta.url));
// src/demo (tsx) and dist/demo (built) both sit one level under the package root.
export const FIXTURES_DIR = resolve(here, "../../fixtures");

export interface Scenario {
  id: string;
  label: string;
  lat: number;
  lon: number;
  fires?: string;
}

let scenariosPromise: Promise<Scenario[]> | undefined;

export async function loadScenarios(): Promise<Scenario[]> {
  scenariosPromise ??= readFile(resolve(FIXTURES_DIR, "scenarios.json"), "utf8").then(
    (text) => (JSON.parse(text) as { scenarios: Scenario[] }).scenarios,
  );
  return scenariosPromise;
}

/** Nearest recorded scenario to the requested point. */
export async function nearestScenario(point: LatLon): Promise<Scenario> {
  const scenarios = await loadScenarios();
  const first = scenarios[0];
  if (!first) throw new Error("No demo scenarios are configured in fixtures/scenarios.json");
  return scenarios.reduce(
    (best, scenario) => (haversineKm(point, scenario) < haversineKm(point, best) ? scenario : best),
    first,
  );
}

/** Recorded FIRMS hotspots, shifted so they keep their geometry around the requested point. */
export async function loadFireFixture(point: LatLon): Promise<FirmsHotspot[]> {
  const scenario = await nearestScenario(point);
  if (!scenario.fires) return [];
  const csv = await readFile(resolve(FIXTURES_DIR, scenario.fires), "utf8");
  const hotspots = parseFirmsCsv(csv);
  const latShift = point.lat - scenario.lat;
  const lonShift = point.lon - scenario.lon;
  // Shifting keeps the demo believable for any nearby point the judge types in,
  // while the distances and bearings the tool reports stay the recorded ones.
  return hotspots.map((hotspot) => ({
    ...hotspot,
    lat: hotspot.lat + latShift,
    lon: hotspot.lon + lonShift,
  }));
}
