import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNwsAlerts } from "../src/sources/nws.js";
import {
  alertsSummary,
  firstInstruction,
  mapNwsSeverity,
  sortBySeverity,
  worstSeverity,
} from "../src/tools/alerts.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/alerts", name), "utf8"));

const hilo = parseNwsAlerts(fixture("hilo-storm.json") as Parameters<typeof parseNwsAlerts>[0]);
const chicago = parseNwsAlerts(fixture("calm.json") as Parameters<typeof parseNwsAlerts>[0]);

describe("parseNwsAlerts", () => {
  it("reads the recorded Hawaii storm alerts", () => {
    expect(hilo.length).toBeGreaterThan(0);
    const first = hilo[0]!;
    expect(first.event).toBeTruthy();
    expect(first.severity).toBeTruthy();
    expect(first.areaDesc).toBeTruthy();
  });

  it("keeps zone-based alerts that carry no geometry", () => {
    // Some alerts are tied to zones; the tool keeps them in `data` but draws nothing.
    expect(hilo.some((alert) => alert.geometry === null)).toBe(true);
  });

  it("returns an empty list when nothing is active", () => {
    expect(chicago).toEqual([]);
  });
});

describe("mapNwsSeverity", () => {
  it("maps the NWS vocabulary onto our scale", () => {
    expect(mapNwsSeverity("Extreme")).toBe("extreme");
    expect(mapNwsSeverity("Severe")).toBe("high");
    expect(mapNwsSeverity("Moderate")).toBe("moderate");
    expect(mapNwsSeverity("Minor")).toBe("low");
    expect(mapNwsSeverity("Unknown")).toBe("none");
    expect(mapNwsSeverity("")).toBe("none");
  });
});

describe("worstSeverity", () => {
  it("is none without alerts", () => {
    expect(worstSeverity([])).toBe("none");
  });

  it("picks the most serious alert from the recording", () => {
    expect(worstSeverity(hilo)).toBe("high"); // Severe hurricane watch / storm warning
  });
});

describe("sortBySeverity", () => {
  it("puts the most serious alert first without mutating the input", () => {
    const original = [...hilo];
    const sorted = sortBySeverity(hilo);
    expect(hilo).toEqual(original);
    const severities = sorted.map((alert) => mapNwsSeverity(alert.severity));
    expect(severities[0]).toBe("high");
  });
});

describe("alertsSummary", () => {
  it("explains that alerts are US-only outside the coverage area", () => {
    expect(alertsSummary([], false)).toMatch(/US locations only/);
  });

  it("says nothing is active for a calm location", () => {
    expect(alertsSummary(chicago, true)).toMatch(/No active official weather alerts/);
  });

  it("leads with the worst event and counts the rest", () => {
    const summary = alertsSummary(hilo, true);
    expect(summary).toContain(sortBySeverity(hilo)[0]!.event);
    expect(summary).toMatch(/more alerts are also active|One more alert/);
    expect(summary.split(". ").length).toBeLessThanOrEqual(2);
  });
});

describe("firstInstruction", () => {
  it("returns one trimmed sentence, or undefined when no alert has instructions", () => {
    const instruction = firstInstruction(hilo);
    if (instruction !== undefined) {
      expect(instruction.length).toBeLessThanOrEqual(160);
      expect(instruction).not.toContain("\n");
    }
    expect(firstInstruction([])).toBeUndefined();
  });
});
