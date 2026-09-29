/**
 * The rule set behind `assess_risk` (SPEC 6).
 *
 * Deliberately not an average: each rule produces a factor with its own level
 * and a recommendation, and the overall level is the worst factor. Pure
 * functions only, so every rule is covered by a test.
 */
import { SEVERITY_ORDER, angleDiff, formatKmAndMiles, type Severity } from "@safezone/shared";

/** Where a factor came from. Escalation needs two high factors from different sources. */
export type FactorSource = "fire" | "alert" | "air" | "quake";

export interface RiskFactor {
  id: string;
  source: FactorSource;
  severity: Severity;
  /** One short phrase naming the hazard, for the panel. */
  title: string;
  /** What the user should do about it (SPEC 6.3). */
  recommendation: string;
}

export interface FireInput {
  count: number;
  closestDistanceKm: number;
  /** Direction from the user to the fire, degrees clockwise from north. */
  closestBearingDeg: number;
  closestDirection: string;
  /** The radius the search covered, used by the "fire within the radius" rule. */
  radiusKm: number;
}

export interface WindInput {
  speedKmh: number;
  /** Meteorological: where the wind blows FROM (SPEC 6.2). */
  fromDeg: number;
}

export interface AlertInput {
  event: string;
  /** Already mapped onto our scale by tools/alerts.ts. */
  severity: Severity;
  instruction?: string;
}

export interface QuakeInput {
  magnitude: number;
  distanceKm: number;
  /** Epoch milliseconds, as USGS reports it. */
  time: number;
}

export interface RiskInputs {
  fire?: FireInput;
  wind?: WindInput;
  alerts: AlertInput[];
  usAqi?: number;
  quakes: QuakeInput[];
  now?: number;
}

export interface RiskAssessment {
  severity: Severity;
  factors: RiskFactor[];
  recommendations: string[];
  /** true when escalation fired, so the summary can explain why (SPEC 6.1). */
  escalated: boolean;
}

/* ------------------------------------------------------------------ thresholds */

export const FIRE_VERY_CLOSE_KM = 10;
export const FIRE_UPWIND_KM = 30;
export const UPWIND_CONE_DEG = 45;
export const UPWIND_MIN_WIND_KMH = 15;
export const QUAKE_NEARBY_KM = 100;
export const QUAKE_RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Is the fire upwind, meaning the wind carries its smoke towards the user?
 *
 * The trap is that `windFromDeg` says where the wind comes FROM. If the fire
 * sits in roughly that direction, whatever it produces is heading our way.
 */
export function isUpwind(bearingToFireDeg: number, windFromDeg: number): boolean {
  return angleDiff(bearingToFireDeg, windFromDeg) <= UPWIND_CONE_DEG;
}

/* ----------------------------------------------------------------------- rules */

function fireFactor(fire: FireInput, wind: WindInput | undefined): RiskFactor | undefined {
  if (fire.count === 0) return undefined;
  const where = `${formatKmAndMiles(fire.closestDistanceKm)} ${fire.closestDirection}`;

  if (fire.closestDistanceKm <= FIRE_VERY_CLOSE_KM) {
    return {
      id: "fire-very-close",
      source: "fire",
      severity: "high",
      title: `An active fire is ${where}`,
      recommendation: "Prepare a go-bag and know your evacuation route.",
    };
  }

  const upwind =
    wind !== undefined &&
    fire.closestDistanceKm <= FIRE_UPWIND_KM &&
    wind.speedKmh >= UPWIND_MIN_WIND_KMH &&
    isUpwind(fire.closestBearingDeg, wind.fromDeg);

  if (upwind) {
    return {
      id: "fire-upwind",
      source: "fire",
      severity: "high",
      title: `A fire ${where} is upwind of you`,
      recommendation: "Prepare a go-bag and know your evacuation route.",
    };
  }

  if (fire.closestDistanceKm <= fire.radiusKm) {
    return {
      id: "fire-in-radius",
      source: "fire",
      severity: "moderate",
      title: `${fire.count} active fire ${fire.count === 1 ? "hotspot" : "hotspots"} nearby, closest ${where}`,
      recommendation: "Watch for changes in the wind and keep your phone charged.",
    };
  }
  return undefined;
}

function alertFactor(alerts: AlertInput[]): RiskFactor | undefined {
  const worst = alerts.reduce<AlertInput | undefined>(
    (best, alert) =>
      best === undefined || SEVERITY_ORDER[alert.severity] > SEVERITY_ORDER[best.severity]
        ? alert
        : best,
    undefined,
  );
  if (!worst || SEVERITY_ORDER[worst.severity] < SEVERITY_ORDER.moderate) return undefined;
  return {
    id: "official-alert",
    source: "alert",
    severity: worst.severity,
    // Starts with a word of ours, not with the event name: riskSummary drops the
    // first letter to lower case when it glues a title mid-sentence, which would
    // otherwise turn "Rip Current Statement" into "rip Current Statement".
    title: `An official ${worst.event} is in effect`,
    recommendation: worst.instruction
      ? `Follow official instructions: ${worst.instruction}`
      : "Follow the instructions of local authorities.",
  };
}

function airFactor(usAqi: number | undefined): RiskFactor | undefined {
  if (usAqi === undefined || usAqi <= 100) return undefined;
  const severity: Severity = usAqi > 200 ? "extreme" : usAqi > 150 ? "high" : "moderate";
  return {
    id: "air-quality",
    source: "air",
    severity,
    title: `Air quality is unhealthy, US AQI ${Math.round(usAqi)}`,
    recommendation:
      severity === "moderate"
        ? "Sensitive groups should limit time outdoors."
        : "Keep windows closed and limit time outside.",
  };
}

function quakeFactor(quakes: QuakeInput[], now: number): RiskFactor | undefined {
  const recentNearby = quakes.filter(
    (quake) => quake.distanceKm <= QUAKE_NEARBY_KM && now - quake.time <= QUAKE_RECENT_MS,
  );
  const strongest = recentNearby.reduce<QuakeInput | undefined>(
    (best, quake) => (best === undefined || quake.magnitude > best.magnitude ? quake : best),
    undefined,
  );
  if (!strongest || strongest.magnitude < 5) return undefined;
  return {
    id: "earthquake",
    source: "quake",
    severity: strongest.magnitude >= 6 ? "high" : "moderate",
    title: `Magnitude ${strongest.magnitude.toFixed(1)} earthquake ${formatKmAndMiles(strongest.distanceKm)} away in the last day`,
    recommendation: "Check your home for damage and expect aftershocks.",
  };
}

/** Applies every rule and combines the results (SPEC 6.1). */
export function assessRisk(inputs: RiskInputs): RiskAssessment {
  const now = inputs.now ?? Date.now();
  const factors = [
    inputs.fire ? fireFactor(inputs.fire, inputs.wind) : undefined,
    alertFactor(inputs.alerts),
    airFactor(inputs.usAqi),
    quakeFactor(inputs.quakes, now),
  ]
    .filter((factor): factor is RiskFactor => factor !== undefined)
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  const worst = factors.reduce<Severity>(
    (level, factor) =>
      SEVERITY_ORDER[factor.severity] > SEVERITY_ORDER[level] ? factor.severity : level,
    "none",
  );

  // Two or more high factors from different sources compound into extreme.
  const highSources = new Set(
    factors.filter((factor) => factor.severity === "high").map((factor) => factor.source),
  );
  const escalated = highSources.size >= 2;
  const severity: Severity = escalated ? "extreme" : worst;

  return {
    severity,
    factors,
    recommendations: [...new Set(factors.map((factor) => factor.recommendation))],
    escalated,
  };
}

/** Spoken summary: the level plus at most two recommendations (SPEC 6.3). */
export function riskSummary(assessment: RiskAssessment, placeLabel?: string): string {
  const where = placeLabel ? ` for ${placeLabel}` : "";
  if (assessment.factors.length === 0) {
    return `I found no active hazards${where} right now.`;
  }
  const level = assessment.severity;
  const lead = assessment.factors[0] as RiskFactor;
  const second = assessment.factors[1];
  const cause =
    second && assessment.escalated
      ? `${lowerFirst(lead.title)} and ${lowerFirst(second.title)}`
      : lowerFirst(lead.title);
  const advice = assessment.recommendations.slice(0, 2).join(" ");
  return `Risk level is ${level}${where}: ${cause}. ${advice}`.trim();
}

/**
 * Titles are written as standalone phrases for the panel, and spliced into a
 * sentence here. Every factor title must therefore begin with an ordinary word
 * of our own — never with an interpolated name, which this would damage.
 */
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
