/**
 * Slice: the family-size histogram and candidate Seed Word list. Curation runs
 * buildPuzzle over every distinct Rhyme Key, dedupes by key (not spelling),
 * filters to a configurable size band, and records why each excluded family was
 * dropped.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { curate } from "../curation.ts";

const index = makeTestIndex();

describe("families are keyed by Rhyme Key, not spelling", () => {
  const report = curate(index, { sizeBand: { min: 1, max: 100 } });

  it("collapses every word sharing a Rhyme Key into one family", () => {
    const keys = report.families.map((f) => f.rhymeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts a family's Answers", () => {
    const family = report.families.find((f) => f.rhymeKey === "EY T");
    // late, eight, collate, impregnate, adjudicate, defenestrate, gate.
    expect(family?.answerCount).toBe(7);
  });

  it("emits a histogram of answer-count -> number of families", () => {
    const total = [...report.histogram.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(report.families.length);
  });

  it("flags a representative that has more than one pronunciation", () => {
    // `read` (IY D and EH D) is the only word under key IY D, so it represents
    // it and is flagged; `bed` represents EH D and is not.
    expect(report.families.find((f) => f.rhymeKey === "IY D")?.multiplePronunciations).toBe(true);
    expect(report.families.find((f) => f.rhymeKey === "EH D")?.multiplePronunciations).toBe(false);
  });
});

describe("the size band and exclusions", () => {
  it("drops families outside the band with a reason", () => {
    const report = curate(index, { sizeBand: { min: 3, max: 5 } });
    const above = report.dropped.find((d) => d.rhymeKey === "EY T");
    expect(above?.reason).toBe("above-band"); // 7 answers > 5
    expect(report.candidates).not.toContainEqual(
      expect.objectContaining({ rhymeKey: "EY T" }),
    );
  });

  it("excludes an accent-unstable Rhyme Key (ate splits US/UK, ADR-0002)", () => {
    const report = curate(index, {
      sizeBand: { min: 1, max: 100 },
      accentUnstable: new Set(["EY T"]),
    });
    expect(report.dropped.find((d) => d.rhymeKey === "EY T")?.reason).toBe("accent-unstable");
  });

  it("blocks a Seed Word with a note that survives the report", () => {
    const report = curate(index, {
      sizeBand: { min: 1, max: 100 },
      blocked: new Map([["bed", "reserved for the tutorial family"]]),
    });
    const dropped = report.dropped.find((d) => d.representative === "bed");
    expect(dropped?.reason).toBe("blocked");
    expect(dropped?.note).toBe("reserved for the tutorial family");
  });
});
