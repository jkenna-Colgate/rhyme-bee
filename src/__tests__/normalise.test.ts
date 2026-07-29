/**
 * The normalisation stage is the accent specification applied to the stored
 * readings at build time (ADR-0010). It runs after the committed supplement and
 * before any Rhyme Key is computed, so a hand-authored reading is an input to it
 * rather than an exemption from it.
 *
 * These tests assert a reading or a verdict, never a rule's internals — which
 * rules exist is implementation detail, but what a player may submit is not.
 */

import { describe, expect, it } from "vitest";
import { applyNormalisation } from "../normalise.ts";
import { applySupplement } from "../supplement.ts";
import { buildTestIndex, makeTestData, makeTestIndex } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";
import { isAccepted } from "../verdict.ts";

function target(entries: [string, Pronunciation[]][] = []) {
  return { pronunciations: new Map(entries) };
}

describe("applyNormalisation", () => {
  it("merges AO into AA, keeping the stress digit", () => {
    const data = target([["talked", [["T", "AO1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("talked")).toEqual([["T", "AA1", "K", "T"]]);
  });

  it("replaces the reading rather than appending a variant", () => {
    // Load-bearing: the respelling layer renders AA and AO differently, so only
    // a replacement makes an accepted rhyme read as a rhyme on screen. It also
    // keeps `talked` a one-Rhyme-Key word instead of an accidental homograph.
    const data = target([["balked", [["B", "AO1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("balked")).toHaveLength(1);
  });

  it("leaves AO alone immediately before R", () => {
    const data = target([["for", [["F", "AO1", "R"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("for")).toEqual([["F", "AO1", "R"]]);
  });

  it("merges AO before L — `ball` takes the `doll` vowel", () => {
    const data = target([["ball", [["B", "AO1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ball")).toEqual([["B", "AA1", "L"]]);
  });

  it("decides each AO on its own position within one reading", () => {
    // `waterborne` has both: AO1 before T merges, AO2 before R does not.
    const data = target([
      ["waterborne", [["W", "AO1", "T", "ER0", "B", "AO2", "R", "N"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("waterborne")).toEqual([
      ["W", "AA1", "T", "ER0", "B", "AO2", "R", "N"],
    ]);
  });

  it("collapses readings that the merge makes identical", () => {
    // CMUdict lists some words both ways; after the merge they are one reading,
    // and a duplicate would otherwise sit in the map forever.
    const data = target([["dog", [["D", "AO1", "G"], ["D", "AA1", "G"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("dog")).toEqual([["D", "AA1", "G"]]);
  });

  it("leaves a reading with no AO untouched", () => {
    const data = target([["docked", [["D", "AA1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("docked")).toEqual([["D", "AA1", "K", "T"]]);
  });
});

describe("a normalised index adjudicates", () => {
  const index = makeTestIndex();
  const docked = index.pinSeed("docked");

  it.each(["talked", "walked", "balked", "stalked", "hawked"])(
    "accepts %j for the Seed Word `docked`",
    (submission) => {
      expect(index.adjudicate(docked, submission).outcome).toBe("answer");
    },
  );

  it("pins `docked` to the Rhyme Key AA K T", () => {
    expect(docked.rhymeKey).toBe("AA K T");
  });

  it("gives `talked` one Rhyme Key, not two — the merge is not a variant", () => {
    expect(index.rhymeKeysOf("talked")).toEqual(["AA K T"]);
    expect(index.isAmbiguous("talked")).toBe(false);
  });

  it("rhymes `ball` with `doll` — pre-lateral position is merged", () => {
    expect(index.adjudicate(index.pinSeed("doll"), "ball").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("ball"), "doll").outcome).toBe("answer");
  });
});

describe("a normalised respelling", () => {
  const index = makeTestIndex();
  const docked = index.pinSeed("docked");

  it("shows the merged vowel, so an acceptance reads as a rhyme", () => {
    // Story 8: the screen must not show two different vowels while calling them
    // a rhyme. `talked` is "TAH-kt" against a Seed respelled "DAH-kt".
    const verdict = index.adjudicate(docked, "talked");
    expect(verdict).toMatchObject({ outcome: "answer", respelling: "TAH-kt" });
    expect(index.buildPuzzle(docked).seedRespelling).toBe("DAH-kt");
  });

  it("shares the rhyming tail of the Seed Word's respelling", () => {
    // Story 7, stated without hard-coding a spelling: whatever the Seed reads
    // as after its onset consonant, every accepted rhyme's respelling contains.
    const tail = index.buildPuzzle(docked).seedRespelling.slice(1).toLowerCase();

    for (const submission of ["talked", "walked", "balked", "stalked", "hawked"]) {
      const verdict = index.adjudicate(docked, submission);
      expect(isAccepted(verdict)).toBe(true);
      if (isAccepted(verdict)) {
        expect(verdict.respelling.toLowerCase()).toContain(tail);
      }
    }
  });
});

describe("normalisation runs after the committed supplement", () => {
  it("applies the accent specification to a hand-authored reading too", () => {
    // A supplement entry asserts a *reading*; normalisation asserts the accent.
    // `chalked` arrives with AO from the human override and is still merged, so
    // the override is an input to the accent spec, not an exemption from it.
    const data = makeTestData();
    applySupplement("chalked  CH AO1 K T", data);
    const index = buildTestIndex(data);

    expect(index.adjudicate(index.pinSeed("docked"), "chalked").outcome).toBe("bonus");
  });
});
