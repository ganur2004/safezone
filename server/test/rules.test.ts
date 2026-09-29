/**
 * The assess_risk rule set (SPEC 6). These rules are the judgement of the whole
 * product, so every row of the table in 6.1 is pinned down here, along with the
 * upwind test that SPEC 6.2 asks for by name.
 */
import { describe, expect, it } from "vitest";
import {
  assessRisk,
  isUpwind,
  riskSummary,
  type AlertInput,
  type FireInput,
  type QuakeInput,
  type RiskInputs,
} from "../src/risk/rules.js";

const NOW = Date.UTC(2026, 8, 27, 12);

const fire = (over: Partial<FireInput> = {}): FireInput => ({
  count: 14,
  closestDistanceKm: 18,
  closestBearingDeg: 45,
  closestDirection: "north-east",
  radiusKm: 50,
  ...over,
});

const quake = (magnitude: number, distanceKm: number, hoursAgo: number): QuakeInput => ({
  magnitude,
  distanceKm,
  time: NOW - hoursAgo * 3600_000,
});

const inputs = (over: Partial<RiskInputs> = {}): RiskInputs => ({
  alerts: [],
  quakes: [],
  now: NOW,
  ...over,
});

describe("isUpwind (SPEC 6.2)", () => {
  it("is true when the fire lies where the wind comes from", () => {
    // Wind from the north-east, fire to the north-east: the smoke comes to us.
    expect(isUpwind(45, 45)).toBe(true);
  });

  it("is false when the fire is downwind", () => {
    // Same wind, fire to the south-west: the smoke blows away from us.
    expect(isUpwind(225, 45)).toBe(false);
  });

  it("uses a 45 degree cone and wraps around north", () => {
    expect(isUpwind(90, 45)).toBe(true); // exactly 45 degrees apart
    expect(isUpwind(91, 45)).toBe(false);
    expect(isUpwind(10, 350)).toBe(true); // 20 degrees apart across 0
    expect(isUpwind(350, 10)).toBe(true);
  });
});

describe("fire rules (SPEC 6.1)", () => {
  it("is high when the closest hotspot is within 10 km", () => {
    const result = assessRisk(inputs({ fire: fire({ closestDistanceKm: 8 }) }));
    expect(result.severity).toBe("high");
    expect(result.factors[0]?.id).toBe("fire-very-close");
  });

  it("is high when a fire within 30 km is upwind and the wind is at least 15 km/h", () => {
    const result = assessRisk(
      inputs({ fire: fire({ closestDistanceKm: 18 }), wind: { speedKmh: 20, fromDeg: 45 } }),
    );
    expect(result.severity).toBe("high");
    expect(result.factors[0]?.id).toBe("fire-upwind");
    expect(result.recommendations[0]).toMatch(/go-bag/);
  });

  it("is only moderate when the same fire is downwind", () => {
    const result = assessRisk(
      inputs({
        fire: fire({
          closestDistanceKm: 18,
          closestBearingDeg: 225,
          closestDirection: "south-west",
        }),
        wind: { speedKmh: 20, fromDeg: 45 },
      }),
    );
    expect(result.severity).toBe("moderate");
    expect(result.factors[0]?.id).toBe("fire-in-radius");
  });

  it("is only moderate when the wind is too weak to carry the fire", () => {
    const result = assessRisk(
      inputs({ fire: fire({ closestDistanceKm: 18 }), wind: { speedKmh: 9, fromDeg: 45 } }),
    );
    expect(result.factors[0]?.id).toBe("fire-in-radius");
  });

  it("is only moderate when an upwind fire is beyond 30 km", () => {
    const result = assessRisk(
      inputs({ fire: fire({ closestDistanceKm: 40 }), wind: { speedKmh: 25, fromDeg: 45 } }),
    );
    expect(result.factors[0]?.id).toBe("fire-in-radius");
  });

  it("reports nothing when there are no hotspots or they are outside the radius", () => {
    expect(assessRisk(inputs({ fire: fire({ count: 0 }) })).factors).toEqual([]);
    expect(
      assessRisk(inputs({ fire: fire({ closestDistanceKm: 80, radiusKm: 50 }) })).factors,
    ).toEqual([]);
  });
});

describe("alert rules (SPEC 6.1)", () => {
  const alert = (severity: AlertInput["severity"]): AlertInput => ({
    event: "Red Flag Warning",
    severity,
  });

  it("maps the alert severity straight through", () => {
    expect(assessRisk(inputs({ alerts: [alert("extreme")] })).severity).toBe("extreme");
    expect(assessRisk(inputs({ alerts: [alert("high")] })).severity).toBe("high");
    expect(assessRisk(inputs({ alerts: [alert("moderate")] })).severity).toBe("moderate");
  });

  it("ignores minor and unknown alerts", () => {
    expect(assessRisk(inputs({ alerts: [alert("low"), alert("none")] })).factors).toEqual([]);
  });

  it("takes the worst alert and quotes its instruction", () => {
    const result = assessRisk(
      inputs({
        alerts: [
          alert("moderate"),
          {
            event: "Tropical Storm Warning",
            severity: "high",
            instruction: "Move to high ground.",
          },
        ],
      }),
    );
    expect(result.factors[0]?.title).toContain("Tropical Storm Warning");
    expect(result.recommendations[0]).toBe("Follow official instructions: Move to high ground.");
  });
});

describe("air quality rules (SPEC 6.1)", () => {
  it("follows the AQI bands, including the boundaries", () => {
    expect(assessRisk(inputs({ usAqi: 100 })).factors).toEqual([]);
    expect(assessRisk(inputs({ usAqi: 101 })).severity).toBe("moderate");
    expect(assessRisk(inputs({ usAqi: 150 })).severity).toBe("moderate");
    expect(assessRisk(inputs({ usAqi: 151 })).severity).toBe("high");
    expect(assessRisk(inputs({ usAqi: 200 })).severity).toBe("high");
    expect(assessRisk(inputs({ usAqi: 201 })).severity).toBe("extreme");
  });

  it("advises closing the windows once it is unhealthy for everyone", () => {
    expect(assessRisk(inputs({ usAqi: 175 })).recommendations[0]).toMatch(/windows closed/);
    expect(assessRisk(inputs({ usAqi: 120 })).recommendations[0]).toMatch(/Sensitive groups/);
  });
});

describe("earthquake rules (SPEC 6.1)", () => {
  it("is moderate from M5 and high from M6 within 100 km in the last day", () => {
    expect(assessRisk(inputs({ quakes: [quake(5.2, 80, 6)] })).severity).toBe("moderate");
    expect(assessRisk(inputs({ quakes: [quake(6.1, 80, 6)] })).severity).toBe("high");
  });

  it("ignores quakes that are weak, far away or older than a day", () => {
    expect(assessRisk(inputs({ quakes: [quake(4.9, 50, 2)] })).factors).toEqual([]);
    expect(assessRisk(inputs({ quakes: [quake(6.5, 300, 2)] })).factors).toEqual([]);
    expect(assessRisk(inputs({ quakes: [quake(6.5, 50, 30)] })).factors).toEqual([]);
  });

  it("picks the strongest qualifying quake", () => {
    const result = assessRisk(inputs({ quakes: [quake(5.1, 50, 2), quake(6.2, 60, 3)] }));
    expect(result.factors[0]?.title).toContain("6.2");
  });
});

describe("escalation (SPEC 6.1)", () => {
  it("turns two high factors from different sources into extreme", () => {
    const result = assessRisk(
      inputs({
        fire: fire({ closestDistanceKm: 8 }), // high
        usAqi: 175, // high
      }),
    );
    expect(result.severity).toBe("extreme");
    expect(result.escalated).toBe(true);
  });

  it("does not escalate a single high factor", () => {
    const result = assessRisk(inputs({ fire: fire({ closestDistanceKm: 8 }) }));
    expect(result.severity).toBe("high");
    expect(result.escalated).toBe(false);
  });

  it("does not escalate two factors from the same source", () => {
    // Only one fire factor can ever fire, so a second high needs another source.
    const result = assessRisk(
      inputs({ fire: fire({ closestDistanceKm: 8 }), wind: { speedKmh: 30, fromDeg: 45 } }),
    );
    expect(result.factors.filter((factor) => factor.severity === "high")).toHaveLength(1);
    expect(result.severity).toBe("high");
  });

  it("does not escalate a high plus a moderate", () => {
    const result = assessRisk(inputs({ fire: fire({ closestDistanceKm: 8 }), usAqi: 120 }));
    expect(result.severity).toBe("high");
    expect(result.escalated).toBe(false);
  });
});

describe("assessRisk output", () => {
  it("is none with nothing to report", () => {
    const result = assessRisk(inputs());
    expect(result).toMatchObject({ severity: "none", factors: [], recommendations: [] });
  });

  it("sorts factors worst first and de-duplicates recommendations", () => {
    const result = assessRisk(
      inputs({ fire: fire({ closestDistanceKm: 8 }), usAqi: 120, alerts: [] }),
    );
    expect(result.factors.map((factor) => factor.severity)).toEqual(["high", "moderate"]);
    expect(new Set(result.recommendations).size).toBe(result.recommendations.length);
  });
});

describe("riskSummary (SPEC 6.3)", () => {
  it("says so when nothing is happening", () => {
    expect(riskSummary(assessRisk(inputs()), "Chicago")).toMatch(/no active hazards for Chicago/);
  });

  it("leads with the level and the worst factor, then at most two recommendations", () => {
    const summary = riskSummary(
      assessRisk(
        inputs({ fire: fire({ closestDistanceKm: 18 }), wind: { speedKmh: 20, fromDeg: 45 } }),
      ),
      "Sacramento",
    );
    expect(summary).toMatch(/^Risk level is high for Sacramento: a fire 18 km \(11 mi\)/);
    expect(summary).toContain("upwind");
    expect(summary).toContain("go-bag");
  });

  it("keeps the alert's own name capitalised when it is spliced into a sentence", () => {
    // The spoken summary lower-cases the first letter of a factor title, which
    // used to turn "Rip Current Statement" into "rip Current Statement".
    const summary = riskSummary(
      assessRisk(inputs({ alerts: [{ event: "Rip Current Statement", severity: "moderate" }] })),
    );
    expect(summary).toContain("an official Rip Current Statement is in effect");
    expect(summary).not.toContain("rip Current Statement");
  });

  it("names both causes when the level was escalated", () => {
    const summary = riskSummary(
      assessRisk(inputs({ fire: fire({ closestDistanceKm: 8 }), usAqi: 175 })),
    );
    expect(summary).toMatch(/^Risk level is extreme:/);
    expect(summary).toContain("air quality");
    expect(summary.split(". ").length).toBeLessThanOrEqual(3);
  });
});
