/**
 * NASA FIRMS Area API — active fire hotspots (spec 5.3 `get_fire_hotspots`).
 * https://firms.modaps.eosdis.nasa.gov/api/area/
 * MAP_KEY is free; `days` accepts 1–10.
 */
import { bboxAround, type LatLon } from "@safezone/shared";
import { config } from "../config.js";
import { parseCsv } from "../lib/csv.js";
import { cacheKey, fetchText, withCache } from "../lib/http.js";
import { SourceUnavailableError } from "../lib/errors.js";

export const FIRMS_SOURCE_NAME = "NASA FIRMS";
export const FIRMS_DATASET = "VIIRS_SNPP_NRT";
export const FIRMS_HUMAN_URL = "https://firms.modaps.eosdis.nasa.gov/";
export const FIRMS_MIN_DAYS = 1;
export const FIRMS_MAX_DAYS = 10;

/** Raw hotspot as reported by FIRMS, already typed. */
export interface FirmsHotspot {
  lat: number;
  lon: number;
  /** "l" low, "n" nominal, "h" high (VIIRS). */
  confidence: string;
  /** Fire radiative power in MW; drives the marker size on the map. */
  frp: number;
  acquiredAt: string;
  satellite: string;
}

/** Parses the FIRMS CSV payload. Rows without usable coordinates are dropped. */
export function parseFirmsCsv(text: string): FirmsHotspot[] {
  return parseCsv(text).flatMap((row) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const frp = Number(row.frp);
    return [
      {
        lat,
        lon,
        confidence: (row.confidence ?? "").toLowerCase(),
        frp: Number.isFinite(frp) ? frp : 0,
        acquiredAt: toIsoTimestamp(row.acq_date, row.acq_time),
        satellite: row.satellite ?? "",
      },
    ];
  });
}

/** FIRMS reports `acq_date` as YYYY-MM-DD and `acq_time` as HHMM in UTC. */
function toIsoTimestamp(date: string | undefined, time: string | undefined): string {
  if (!date) return "";
  const padded = (time ?? "0000").padStart(4, "0");
  return `${date}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:00Z`;
}

export interface FirmsQuery extends LatLon {
  radiusKm: number;
  days: number;
}

export function firmsRequestUrl(query: FirmsQuery, mapKey: string): string {
  const [west, south, east, north] = bboxAround(query, query.radiusKm).map((value) =>
    value.toFixed(4),
  );
  const days = Math.min(FIRMS_MAX_DAYS, Math.max(FIRMS_MIN_DAYS, Math.round(query.days)));
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${FIRMS_DATASET}/${west},${south},${east},${north}/${days}`;
}

/** Fetches hotspots for the bbox around a point. Throws SourceUnavailableError on failure. */
export async function fetchFirmsHotspots(query: FirmsQuery): Promise<FirmsHotspot[]> {
  const mapKey = config.firmsMapKey;
  if (!mapKey) {
    throw new SourceUnavailableError(
      FIRMS_SOURCE_NAME,
      "fire data is not configured (missing FIRMS_MAP_KEY)",
    );
  }
  const key = cacheKey("firms", {
    lat: query.lat,
    lon: query.lon,
    radiusKm: query.radiusKm,
    days: query.days,
  });
  return withCache(key, async () => {
    const text = await fetchText(firmsRequestUrl(query, mapKey), {
      sourceName: FIRMS_SOURCE_NAME,
    });
    // An invalid key or an over-quota key answers with an HTML/text page, not CSV.
    if (!/^\s*[\w,]*latitude/i.test(text)) {
      throw new SourceUnavailableError(FIRMS_SOURCE_NAME, "fire data request was rejected");
    }
    return parseFirmsCsv(text);
  });
}
