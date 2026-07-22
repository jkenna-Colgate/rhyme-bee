/**
 * Slice: wordhood and Proper Noun exclusion. A name is never valid however well
 * it rhymes, and it must fail differently from a typo — the interface needs to
 * tell a rule from a bug, and a wrong guess from a misspelling.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";

const index = makeTestIndex();
const ate = index.pinSeed("ate");

describe("proper noun exclusion", () => {
  it("rejects a rhyming name with reason proper-noun", () => {
    expect(index.adjudicate(ate, "Kate")).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });
  });
});

describe("wordhood", () => {
  it("rejects a non-word with reason not-a-known-word", () => {
    expect(index.adjudicate(ate, "florp")).toMatchObject({
      outcome: "rejected",
      reason: "not-a-known-word",
    });
  });

  it("gives three distinguishable rejections for name, non-word and non-rhyme", () => {
    const reasons = [
      index.adjudicate(ate, "Kate"),
      index.adjudicate(ate, "florp"),
      index.adjudicate(ate, "chocolate"),
    ].map((v) => (v.outcome === "rejected" ? v.reason : v.outcome));
    expect(new Set(reasons)).toEqual(
      new Set(["proper-noun", "not-a-known-word", "does-not-rhyme"]),
    );
  });
});
