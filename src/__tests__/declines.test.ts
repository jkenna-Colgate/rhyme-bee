/**
 * The Declines file's format: the one thing an editor's ruling on a Candidate
 * writes, keyed on the word and the Rhyme Key together (#176).
 *
 * Follows `demotions.test.ts` as prior art — round-tripping, comments and
 * blanks, the lookup — and departs from it in one place on purpose: a malformed
 * line here is dropped rather than thrown over, because a Decline changes no
 * verdict and refusing to read the file would cost every standing ruling to
 * spare one typo.
 */

import { describe, expect, it } from "vitest";
import {
  declineKey,
  declinedPairs,
  parseDeclines,
  serialiseDecline,
  type Decline,
} from "../declines.ts";

describe("the Declines format", () => {
  it("round-trips a ruling through the file", () => {
    const declines: Decline[] = [
      { word: "docked", rhymeKey: "AA K T" },
      { word: "chocolate", rhymeKey: "EY T" },
    ];
    const text = declines.map(serialiseDecline).join("");

    expect(parseDeclines(text)).toEqual(declines);
  });

  it("reads a Rhyme Key that holds spaces, which is most of them", () => {
    expect(parseDeclines("shellshocked AA K T\n")).toEqual([
      { word: "shellshocked", rhymeKey: "AA K T" },
    ]);
  });

  it("ignores comments, blank lines and hand-alignment", () => {
    const text = [
      "# Rulings the editor has already made. Nothing here changes a verdict.",
      "",
      "docked      AA K T   # heard as a rhyme for `dock`; the reading is right",
      "   ",
      "lbs   AH B AH L",
    ].join("\n");

    expect(parseDeclines(text)).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "lbs", rhymeKey: "AH B AH L" },
    ]);
  });

  it("normalises the word on the way out and on the way back", () => {
    expect(serialiseDecline({ word: "  Docked ", rhymeKey: "AA K T" })).toBe("docked AA K T\n");
    expect(parseDeclines("  Docked   AA K T  \n")).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  it("drops a malformed line rather than throwing over the whole file", () => {
    const text = [
      "docked",              // no key at all
      "docked aa k t",       // not a Rhyme Key
      "docked AA K T",       // the one good line
      "docked 42",           // not a Rhyme Key either
    ].join("\n");

    expect(parseDeclines(text)).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  it("reads an absent file's empty text as no rulings", () => {
    expect(parseDeclines("")).toEqual([]);
  });
});

describe("the word-and-key lookup", () => {
  const standing = declinedPairs([{ word: "docked", rhymeKey: "AA K T" }]);

  it("answers the pair it was given", () => {
    expect(standing.has(declineKey("docked", "AA K T"))).toBe(true);
  });

  it("does not answer the same word aimed at another key", () => {
    expect(standing.has(declineKey("docked", "AA K"))).toBe(false);
  });

  it("does not answer another word aimed at the same key", () => {
    expect(standing.has(declineKey("talked", "AA K T"))).toBe(false);
  });

  it("looks a word up under the spelling the queue normalises it to", () => {
    expect(standing.has(declineKey(" Docked ", "AA K T"))).toBe(true);
  });
});
