import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/lib/csv.js";

describe("parseCsv", () => {
  it("reads a header row and returns objects with lowercase keys", () => {
    const rows = parseCsv("Latitude,Longitude,FRP\n38.5,-121.4,12.5\n");
    expect(rows).toEqual([{ latitude: "38.5", longitude: "-121.4", frp: "12.5" }]);
  });

  it("handles quoted fields, empty trailing columns and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n"x,1","say ""hi""",\r\n');
    expect(rows[0]).toEqual({ a: "x,1", b: 'say "hi"', c: "" });
  });

  it("returns nothing for an empty payload", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("latitude,longitude\n")).toEqual([]);
  });
});
