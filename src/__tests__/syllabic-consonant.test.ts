/**
 * The syllabic-consonant rule of the normalisation stage (ADR-0010): the schwa
 * before a word-final `L`, `N` or `M` is optional in ordinary General American,
 * so a reading that carries it gains a second reading without it.
 *
 * The rule *appends*, so it can only ever turn a rejection into an acceptance —
 * every reading the index had before is still there, still first. That is what
 * makes it safe to state as a claim about the ear rather than about the data.
 *
 * These tests assert a reading or a verdict, never the rule's internals.
 */

import { describe, expect, it } from "vitest";
import { applyNormalisation } from "../normalise.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";
import { isAccepted } from "../verdict.ts";

function target(entries: [string, Pronunciation[]][] = []) {
  return { pronunciations: new Map(entries) };
}

describe("a schwa before a word-final L, N or M", () => {
  it("gains a reading with the L syllabic, keeping the base reading first", () => {
    const data = target([["gruel", [["G", "R", "UW1", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("gruel")).toEqual([
      ["G", "R", "UW1", "AH0", "L"],
      ["G", "R", "UW1", "L"],
    ]);
  });

  it("gains a reading with the N syllabic", () => {
    const data = target([["ribbon", [["R", "IH1", "B", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ribbon")).toContainEqual(["R", "IH1", "B", "N"]);
  });

  it("gains a reading with the M syllabic", () => {
    const data = target([["album", [["AE1", "L", "B", "AH0", "M"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("album")).toContainEqual(["AE1", "L", "B", "M"]);
  });

  it("appends variants after every base reading, in the order they arrived", () => {
    // Load-bearing: a Seed Word is spoken and respelled in its first reading, so
    // a variant must never displace the reading the data actually asserts.
    const data = target([
      ["duel", [["D", "UW1", "AH0", "L"], ["D", "Y", "UW1", "AH0", "L"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("duel")).toEqual([
      ["D", "UW1", "AH0", "L"],
      ["D", "Y", "UW1", "AH0", "L"],
      ["D", "UW1", "L"],
      ["D", "Y", "UW1", "L"],
    ]);
  });

  it("collapses a variant the data already lists", () => {
    // Some words arrive from CMUdict with both readings. The rule derives one
    // that is already there, and a duplicate reading would sit in the map
    // forever without ever mattering.
    const data = target([["duel", [["D", "UW1", "AH0", "L"], ["D", "UW1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("duel")).toEqual([
      ["D", "UW1", "AH0", "L"],
      ["D", "UW1", "L"],
    ]);
  });
});

describe("the vowels the rule must not drop", () => {
  it("leaves a stressed final vowel alone, so a Rhyme Key keeps its anchor", () => {
    const data = target([["annul", [["AH0", "N", "AH1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("annul")).toEqual([["AH0", "N", "AH1", "L"]]);
  });

  it("leaves a full unstressed vowel alone — only a schwa is reducible", () => {
    const data = target([["crayon", [["K", "R", "EY1", "AA0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("crayon")).toEqual([["K", "R", "EY1", "AA0", "N"]]);
  });

  it("leaves a schwa before any other consonant alone", () => {
    // The `-ate` guardrail lives here: no sonorant follows, so nothing is
    // syllabic and the schwa is the whole audible contrast.
    const data = target([["private", [["P", "R", "AY1", "V", "AH0", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("private")).toEqual([
      ["P", "R", "AY1", "V", "AH0", "T"],
    ]);
  });

  it("leaves a word-internal schwa alone, even before an L", () => {
    // `chocolate`: the schwa in `-co-la-` is not syllable-final, and dropping it
    // is a different claim about a different speech habit.
    const data = target([
      ["chocolate", [["CH", "AA1", "K", "AH0", "L", "AH0", "T"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("chocolate")).toEqual([
      ["CH", "AA1", "K", "AH0", "L", "AH0", "T"],
    ]);
  });

  it("leaves a reading whose only vowel is that schwa alone", () => {
    // Nothing would remain to anchor a Rhyme Key, so the variant would be a
    // reading the index could never match on.
    const data = target([["an", [["AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("an")).toEqual([["AH0", "N"]]);
  });
});

describe("a normalised index adjudicates against the Seed Word `cool`", () => {
  const index = makeTestIndex();
  const cool = index.pinSeed("cool", "UW L");

  it.each(["gruel", "duel", "crewel", "renewal"])(
    "accepts %j, whose final schwa most speakers drop",
    (submission) => {
      expect(isAccepted(index.adjudicate(cool, submission))).toBe(true);
    },
  );

  it("tiers `crewel` as a Bonus Word — the rule decides rhyme, not knownness", () => {
    expect(index.adjudicate(cool, "crewel").outcome).toBe("bonus");
  });

  it("still accepts `pool`, whose final vowel is stressed", () => {
    expect(index.adjudicate(cool, "pool").outcome).toBe("answer");
  });

  it("keeps the two-syllable reading of `gruel` alongside the one-syllable one", () => {
    expect(index.rhymeKeysOf("gruel")).toEqual(["UW AH L", "UW L"]);
  });

  it("puts every one of them in the `cool` Puzzle", () => {
    const puzzle = index.buildPuzzle(cool);
    const members = [...puzzle.answers, ...puzzle.bonusWords].map((e) => e.word);

    expect(members).toEqual(expect.arrayContaining(["gruel", "duel", "crewel", "renewal"]));
  });
});

describe("a full vowel still separates two words", () => {
  const index = makeTestIndex();

  it("does not turn `crayon` into `crane`", () => {
    // `AA0` is unstressed but not reduced. Dropping it would be a claim about
    // the ear that no General American listener would recognise.
    expect(index.adjudicate(index.pinSeed("crane"), "crayon")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
    expect(index.adjudicate(index.pinSeed("crayon"), "crane")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });
});
