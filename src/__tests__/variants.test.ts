/**
 * Slice: variant pronunciations and asymmetric matching. A Submission rhymes if
 * *any* of its Rhyme Keys matches; the Seed Word is pinned to exactly one. The
 * accepted verdict reports the reading that justified it, not an alternate.
 */

import { describe, expect, it } from "vitest";
import { isAccepted } from "../verdict.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";

const index = makeTestIndex();

describe("a word maps to a set of Rhyme Keys", () => {
  it("gives an ambiguous spelling more than one key", () => {
    expect(index.rhymeKeysOf("tear").sort()).toEqual(["EH R", "IH R"]);
  });

  it("gives an unambiguous word exactly one", () => {
    expect(index.rhymeKeysOf("beer")).toEqual(["IH R"]);
  });
});

describe("pinning a Seed Word", () => {
  it("auto-pins a word with a single pronunciation", () => {
    expect(index.pinSeed("beer").rhymeKey).toBe("IH R");
  });

  it("refuses to auto-pin an ambiguous word without an explicit key", () => {
    expect(() => index.pinSeed("tear")).toThrow(/pronunciations/);
  });

  it("pins an ambiguous word when given the key", () => {
    expect(index.pinSeed("tear", "EH R").rhymeKey).toBe("EH R");
  });

  it("refuses an explicit key that is not one of the word's Rhyme Keys", () => {
    // A mistyped key would otherwise silently build an incoherent Puzzle.
    expect(() => index.pinSeed("ate", "IH R")).toThrow(/not one of its Rhyme Keys/);
  });
});

describe("a Seed is never pinned to a generated variant (#75)", () => {
  // `gruel` (syllabic-consonant, issue #74) and `module` (stress-promotion,
  // issue #73) each carry one dictionary reading and one normalisation
  // appended alongside it, so each is ambiguous the same way `tear` is — but
  // only one of the two keys was ever actually transcribed. ADR-0002 makes the
  // Seed's spoken audio load-bearing, so pinning must never land on the other.

  it("pins `gruel` to its dictionary reading", () => {
    expect(index.pinSeed("gruel", "UW AH L").rhymeKey).toBe("UW AH L");
  });

  it("refuses to pin `gruel` to the syllabic-consonant variant", () => {
    expect(() => index.pinSeed("gruel", "UW L")).toThrow(/generated variant/);
  });

  it("pins `module` to its dictionary reading", () => {
    expect(index.pinSeed("module", "AA JH UW L").rhymeKey).toBe("AA JH UW L");
  });

  it("refuses to pin `module` to the stress-promotion variant", () => {
    expect(() => index.pinSeed("module", "UW L")).toThrow(/generated variant/);
  });

  it("still lets `gruel` and `module` rhyme wherever they are Submissions, not Seeds", () => {
    // The restriction is on the Seed's pronunciation choice only — adjudication
    // for every other Submission is unchanged.
    const cool = index.pinSeed("cool", "UW L");
    expect(index.adjudicate(cool, "gruel").outcome).toBe("answer");
    expect(index.adjudicate(cool, "module").outcome).toBe("answer");
  });

  it("is deterministic — the same pinned inputs refuse the same variant on every rebuild", () => {
    const again = makeTestIndex();
    expect(() => index.pinSeed("gruel", "UW L")).toThrow(/generated variant/);
    expect(() => again.pinSeed("gruel", "UW L")).toThrow(/generated variant/);
    expect(again.pinSeed("gruel", "UW AH L")).toEqual(index.pinSeed("gruel", "UW AH L"));
  });
});

describe("asymmetric matching", () => {
  it("accepts a homophone (eight for ate)", () => {
    expect(index.adjudicate(index.pinSeed("ate"), "eight").outcome).toBe("answer");
  });

  it("accepts read for bed on the strength of its second pronunciation", () => {
    const verdict = index.adjudicate(index.pinSeed("bed"), "read");
    expect(verdict.outcome).toBe("answer");
    // The reported reading is R EH1 D, the one that matched — not R IY1 D.
    if (isAccepted(verdict)) expect(verdict.pronunciation).toEqual(["R", "EH1", "D"]);
  });

  it("honours both readings of the same spelling in different Puzzles", () => {
    const forBeer = index.adjudicate(index.pinSeed("beer"), "tear");
    const forCare = index.adjudicate(index.pinSeed("care"), "tear");
    expect(forBeer.outcome).toBe("answer");
    expect(forCare.outcome).toBe("answer");
    if (isAccepted(forBeer)) expect(forBeer.pronunciation).toEqual(["T", "IH1", "R"]);
    if (isAccepted(forCare)) expect(forCare.pronunciation).toEqual(["T", "EH1", "R"]);
  });
});
