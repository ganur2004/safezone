/**
 * Open-Meteo: geocoding, air quality and wind (spec 5.3). No key required,
 * which also makes it our fallback when Amazon Location is not configured.
 */
import type { LatLon, SourceRef } from "@safezone/shared";
import { cacheKey, fetchJson, withCache } from "../lib/http.js";

export const OPEN_METEO_GEOCODING_SOURCE = "Open-Meteo Geocoding";
export const OPEN_METEO_AIR_SOURCE = "Open-Meteo Air Quality";
export const OPEN_METEO_WEATHER_SOURCE = "Open-Meteo Forecast";

export const openMeteoSource = (name: string): SourceRef => ({
  name,
  url: "https://open-meteo.com/",
  fetchedAt: new Date().toISOString(),
});

/* ------------------------------------------------------------------ geocoding */

export interface GeocodedPlace extends LatLon {
  name: string;
  country: string;
  countryCode: string;
  admin1?: string;
}

interface OpenMeteoGeocodingResponse {
  results?: {
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    country_code?: string;
    admin1?: string;
  }[];
}

export function parseOpenMeteoGeocoding(
  body: OpenMeteoGeocodingResponse,
): GeocodedPlace | undefined {
  const first = body.results?.[0];
  if (!first || first.latitude === undefined || first.longitude === undefined) return undefined;
  const place: GeocodedPlace = {
    name: first.name ?? "Unknown place",
    lat: first.latitude,
    lon: first.longitude,
    country: first.country ?? "",
    countryCode: (first.country_code ?? "").toUpperCase(),
  };
  return first.admin1 ? { ...place, admin1: first.admin1 } : place;
}

export async function geocodeWithOpenMeteo(query: string): Promise<GeocodedPlace | undefined> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search" +
    `?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  return withCache(cacheKey("open-meteo-geocoding", { query: query.toLowerCase() }), async () =>
    parseOpenMeteoGeocoding(
      await fetchJson<OpenMeteoGeocodingResponse>(url, {
        sourceName: OPEN_METEO_GEOCODING_SOURCE,
      }),
    ),
  );
}

/* --------------------------------------------------------------- air quality */

export interface AirQualityReading {
  usAqi: number | undefined;
  pm2_5: number | undefined;
  pm10: number | undefined;
  observedAt: string | undefined;
}

interface OpenMeteoAirResponse {
  current?: { time?: string; us_aqi?: number; pm2_5?: number; pm10?: number };
}

export function parseAirQuality(body: OpenMeteoAirResponse): AirQualityReading {
  return {
    usAqi: body.current?.us_aqi,
    pm2_5: body.current?.pm2_5,
    pm10: body.current?.pm10,
    observedAt: body.current?.time,
  };
}

export async function fetchAirQuality(point: LatLon): Promise<AirQualityReading> {
  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${point.lat}&longitude=${point.lon}&current=us_aqi,pm2_5,pm10`;
  return withCache(cacheKey("open-meteo-air", { ...point }), async () =>
    parseAirQuality(
      await fetchJson<OpenMeteoAirResponse>(url, { sourceName: OPEN_METEO_AIR_SOURCE }),
    ),
  );
}

/* ---------------------------------------------------------------------- wind */

export interface WindReading {
  speedKmh: number | undefined;
  gustsKmh: number | undefined;
  /** Meteorological direction: where the wind blows FROM (spec 6.2). */
  fromDeg: number | undefined;
  observedAt: string | undefined;
}

interface OpenMeteoWeatherResponse {
  current?: {
    time?: string;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
}

export function parseWind(body: OpenMeteoWeatherResponse): WindReading {
  return {
    speedKmh: body.current?.wind_speed_10m,
    gustsKmh: body.current?.wind_gusts_10m,
    fromDeg: body.current?.wind_direction_10m,
    observedAt: body.current?.time,
  };
}

export async function fetchWind(point: LatLon): Promise<WindReading> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${point.lat}&longitude=${point.lon}` +
    "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh";
  return withCache(cacheKey("open-meteo-wind", { ...point }), async () =>
    parseWind(
      await fetchJson<OpenMeteoWeatherResponse>(url, { sourceName: OPEN_METEO_WEATHER_SOURCE }),
    ),
  );
}
