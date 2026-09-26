/** US EPA AQI categories (spec 5.3 `get_air_quality`). */
import type { Severity } from "@safezone/shared";

export type AqiCategory =
  | "Good"
  | "Moderate"
  | "Unhealthy for Sensitive Groups"
  | "Unhealthy"
  | "Very Unhealthy"
  | "Hazardous";

export interface AqiBand {
  category: AqiCategory;
  /** Map colour, EPA's own palette. */
  color: string;
  severity: Severity;
}

const HAZARDOUS: AqiBand = { category: "Hazardous", color: "#7e0023", severity: "extreme" };

const BANDS: { max: number; band: AqiBand }[] = [
  { max: 50, band: { category: "Good", color: "#00e400", severity: "none" } },
  { max: 100, band: { category: "Moderate", color: "#ffff00", severity: "low" } },
  {
    max: 150,
    band: { category: "Unhealthy for Sensitive Groups", color: "#ff7e00", severity: "moderate" },
  },
  { max: 200, band: { category: "Unhealthy", color: "#ff0000", severity: "high" } },
  { max: 300, band: { category: "Very Unhealthy", color: "#8f3f97", severity: "extreme" } },
  { max: Infinity, band: HAZARDOUS },
];

export function aqiBand(usAqi: number): AqiBand {
  return BANDS.find((entry) => usAqi <= entry.max)?.band ?? HAZARDOUS;
}

export function airQualitySummary(usAqi: number | undefined, band: AqiBand | undefined): string {
  if (usAqi === undefined || !band) {
    return "Air quality data is temporarily unavailable for this location.";
  }
  const advice =
    band.severity === "none" || band.severity === "low"
      ? ""
      : band.category === "Unhealthy for Sensitive Groups"
        ? " Sensitive groups should limit time outdoors."
        : " Keep windows closed and limit time outside.";
  return `Air quality is ${band.category.toLowerCase()} with a US AQI of ${Math.round(usAqi)}.${advice}`;
}
