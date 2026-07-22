/**
 * The pipeline parsers turn pinned raw inputs into index data. Tested on small
 * inline samples so they need no committed data files.
 */

import { describe, expect, it } from "vitest";
import { parsePrevalenceCsv, parseWordList } from "../pipeline.ts";

describe("parseWordList", () => {
  it("lower-cases tokens and skips comments and blanks", () => {
    const set = parseWordList("# names\nGate\n\nplates\n");
    expect(set).toEqual(new Set(["gate", "plates"]));
  });
});

describe("parsePrevalenceCsv", () => {
  it("maps the word column to the prevalence column, lower-cased", () => {
    const csv = "Word,Prevalence\nGate,2.40\nobjurgate,0.20\n";
    const map = parsePrevalenceCsv(csv);
    expect(map.get("gate")).toBe(2.4);
    expect(map.get("objurgate")).toBe(0.2);
  });

  it("skips rows with an unparseable score rather than defaulting them", () => {
    const csv = "Word,Prevalence\ngood,1.5\nbad,not-a-number\n";
    const map = parsePrevalenceCsv(csv);
    expect(map.has("good")).toBe(true);
    expect(map.has("bad")).toBe(false);
  });

  it("throws when the named columns are absent", () => {
    expect(() => parsePrevalenceCsv("a,b\n1,2\n")).toThrow(/missing columns/);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Word,Prevalence\n"foo,bar",1.0\n';
    const map = parsePrevalenceCsv(csv);
    expect(map.get("foo,bar")).toBe(1.0);
  });
});
