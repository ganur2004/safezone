import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scenarioForQuery } from "../src/demo/fixtures.js";
import { parseOpenMeteoGeocoding } from "../src/sources/openMeteo.js";

const fixture = (name: string): Parameters<typeof parseOpenMeteoGeocoding>[0] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/geocode", name), "utf8"));

describe("parseOpenMeteoGeocoding", () => {
  it("reads the recorded Sacramento lookup", () => {
    const place = parseOpenMeteoGeocoding(fixture("sacramento-fires.json"));
    expect(place?.name).toBe("Sacramento");
    expect(place?.lat).toBeCloseTo(38.58, 1);
    expect(place?.lon).toBeCloseTo(-121.49, 1);
    expect(place?.countryCode).toBe("US");
    expect(place?.admin1).toBe("California");
  });

  it("returns undefined when nothing matched", () => {
    expect(parseOpenMeteoGeocoding({})).toBeUndefined();
    expect(parseOpenMeteoGeocoding({ results: [] })).toBeUndefined();
    expect(parseOpenMeteoGeocoding({ results: [{ name: "No coordinates" }] })).toBeUndefined();
  });

  it("uppercases the country code and tolerates missing fields", () => {
    const place = parseOpenMeteoGeocoding({
      results: [{ latitude: 1, longitude: 2, country_code: "us" }],
    });
    expect(place).toEqual({
      name: "Unknown place",
      lat: 1,
      lon: 2,
      country: "",
      countryCode: "US",
    });
  });
});

describe("scenarioForQuery (DEMO_MODE lookup)", () => {
  it("matches a scenario by name, alias or a name inside a sentence", async () => {
    expect((await scenarioForQuery("Sacramento"))?.id).toBe("sacramento-fires");
    expect((await scenarioForQuery("my home in Sacramento"))?.id).toBe("sacramento-fires");
    expect((await scenarioForQuery("LA"))?.id).toBe("los-angeles");
    expect((await scenarioForQuery("Chicago, IL"))?.id).toBe("calm");
  });

  it("matches whole words only, so 'LA' does not hide inside 'Big Island'", async () => {
    expect((await scenarioForQuery("Big Island"))?.id).toBe("hilo-storm");
    expect((await scenarioForQuery("Hawaii"))?.id).toBe("hilo-storm");
  });

  it("returns undefined for an empty or unknown query", async () => {
    expect(await scenarioForQuery("  ")).toBeUndefined();
    expect(await scenarioForQuery("Ulaanbaatar")).toBeUndefined();
  });
});
