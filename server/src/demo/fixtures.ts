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

/** One recorded location. Each field points at the raw response for that source. */
export interface Scenario {
  id: string;
  label: string;
  lat: number;
  lon: number;
  fires?: string;
  alerts?: string;
  quakes?: string;
  air?: string;
  wind?: string;
  places?: string;
  geocode?: string;
  /** Queries that should resolve to this scenario in DEMO_MODE geocoding. */
  aliases?: string[];
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word containment: "LA" must not match "Big Island" through "isLAnd". */
const containsPhrase = (haystack: string, phrase: string): boolean =>
  new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(haystack);

/** Scenario whose id, label or aliases best match a free-text query. */
export async function scenarioForQuery(query: string): Promise<Scenario | undefined> {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  const scenarios = await loadScenarios();
  const terms = (scenario: Scenario): string[] =>
    [scenario.id, scenario.label, ...(scenario.aliases ?? [])].map((value) => value.toLowerCase());

  // An alias equal to, inside, or containing the query — always as whole words,
  // so "my home in Sacramento" matches but "Big Island" does not match "LA".
  const direct = scenarios.find((scenario) =>
    terms(scenario).some(
      (candidate) =>
        candidate === needle ||
        containsPhrase(needle, candidate) ||
        containsPhrase(candidate, needle),
    ),
  );
  if (direct) return direct;

  // Fall back to single significant words shared with the scenario's terms.
  const words = needle.split(/[^a-z]+/).filter((word) => word.length > 3);
  return scenarios.find((scenario) => {
    const joined = terms(scenario).join(" ");
    return words.some((word) => containsPhrase(joined, word));
  });
}

/** Reads one recorded JSON payload, or undefined when the scenario has none. */
export async function loadJsonFixture<T>(
  scenario: Scenario,
  field: keyof Scenario,
): Promise<T | undefined> {
  const path = scenario[field];
  if (typeof path !== "string") return undefined;
  return JSON.parse(await readFile(resolve(FIXTURES_DIR, path), "utf8")) as T;
}

/** Recorded payload for the scenario nearest to `point`. */
export async function loadNearestJsonFixture<T>(
  point: LatLon,
  field: keyof Scenario,
): Promise<T | undefined> {
  return loadJsonFixture<T>(await nearestScenario(point), field);
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
