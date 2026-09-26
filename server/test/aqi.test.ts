import { describe, expect, it } from "vitest";
import { airQualitySummary, aqiBand } from "../src/tools/aqi.js";

describe("aqiBand", () => {
  it("follows the EPA breakpoints, including the boundaries", () => {
    expect(aqiBand(0).category).toBe("Good");
    expect(aqiBand(50).category).toBe("Good");
    expect(aqiBand(51).category).toBe("Moderate");
    expect(aqiBand(100).category).toBe("Moderate");
    expect(aqiBand(101).category).toBe("Unhealthy for Sensitive Groups");
    expect(aqiBand(150).category).toBe("Unhealthy for Sensitive Groups");
    expect(aqiBand(151).category).toBe("Unhealthy");
    expect(aqiBand(200).category).toBe("Unhealthy");
    expect(aqiBand(201).category).toBe("Very Unhealthy");
    expect(aqiBand(300).category).toBe("Very Unhealthy");
    expect(aqiBand(301).category).toBe("Hazardous");
    expect(aqiBand(900).category).toBe("Hazardous");
  });

  it("maps categories to the severities used by assess_risk (spec 6.1)", () => {
    expect(aqiBand(25).severity).toBe("none");
    expect(aqiBand(75).severity).toBe("low");
    expect(aqiBand(120).severity).toBe("moderate");
    expect(aqiBand(175).severity).toBe("high");
    expect(aqiBand(250).severity).toBe("extreme");
  });
});

describe("airQualitySummary", () => {
  it("says so when the reading is missing", () => {
    expect(airQualitySummary(undefined, undefined)).toMatch(/temporarily unavailable/);
  });

  it("reports the category and AQI, and advises only when it matters", () => {
    expect(airQualitySummary(25, aqiBand(25))).toBe("Air quality is good with a US AQI of 25.");
    expect(airQualitySummary(120, aqiBand(120))).toMatch(/Sensitive groups should limit/);
    expect(airQualitySummary(175, aqiBand(175))).toMatch(/Keep windows closed/);
  });
});
