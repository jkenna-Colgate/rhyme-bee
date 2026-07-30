/**
 * The derivation detector (ADR-0008): is a surface form a regular inflection or a
 * common-prefix affixation of a *dictionary* word, or does it carry native rhyme
 * content of its own? "Derived relative to other real words" is the whole idea,
 * so every case is asserted against an explicit little dictionary predicate.
 */

import { describe, expect, it } from "vitest";
import { isDerived } from "../lemmatise.ts";
import type { Pronunciation } from "../phonology.ts";

// A tiny dictionary of bases. `isDerived` is derivation *relative to* this set:
// a word is derived only when a real base for it exists here.
const dictionary = new Set<string>([
  "down", "king", "book", "combine", "aid", "stand",
  "find", "mind", "blind", "taste", "waste", "read", "do",
  // The three-letter `-s` forms and their candidate bases (issue #97). Whether
  // each is an inflection is settled by the readings below, not by this list.
  "ups", "up", "has", "ha", "gas", "ga",
]);
const isWord = (w: string): boolean => dictionary.has(w);

// Readings, for the words whose derivation turns on sound. A word with no entry
// here has no reading, which is the ordinary case for the four-letter-and-longer
// words above — they never consult one.
const readings = new Map<string, Pronunciation[]>([
  ["ups", [["AH1", "P", "S"]]],
  ["up", [["AH1", "P"]]],
  ["has", [["HH", "AE1", "Z"]]],
  ["ha", [["HH", "AA1"]]],
  ["gas", [["G", "AE1", "S"]]],
  ["ga", [["G", "AA1"]]],
]);
const readingsOf = (w: string): Pronunciation[] => readings.get(w) ?? [];

describe("isDerived — inflection pass", () => {
  it.each(["downs", "kings", "books"])(
    "treats the plural %j as derived from its base",
    (word) => {
      expect(isDerived(word, isWord, readingsOf)).toBe(true);
    },
  );

  it("treats a past-tense inflection as derived (combined ← combine)", () => {
    expect(isDerived("combined", isWord, readingsOf)).toBe(true);
  });

  it("treats a progressive inflection as derived (aiding ← aid)", () => {
    expect(isDerived("aiding", isWord, readingsOf)).toBe(true);
  });
});

describe("isDerived — prefix pass", () => {
  it("catches a prefix on an inflected base (unaided ← un + aided ← aid)", () => {
    // The base `aided` is itself an inflection of `aid`; without the prefix pass
    // `unaided` masquerades as native and its shadow key wrongly survives.
    expect(isDerived("unaided", isWord, readingsOf)).toBe(true);
  });

  it("catches a prefix on an inflected base (outstanding ← out + standing ← stand)", () => {
    expect(isDerived("outstanding", isWord, readingsOf)).toBe(true);
  });

  it("catches a prefix directly on a base word (redo ← re + do)", () => {
    expect(isDerived("redo", isWord, readingsOf)).toBe(true);
  });

  it("does not treat a prefix that merely starts the word as derivation (read: re + ad, no such base)", () => {
    expect(isDerived("read", isWord, readingsOf)).toBe(false);
  });
});

describe("isDerived — a three-letter plural, when the sound agrees (issue #97)", () => {
  it("treats ups as derived: AH1 P S is up's reading plus a final S", () => {
    expect(isDerived("ups", isWord, readingsOf)).toBe(true);
  });

  it("leaves has native: HH AE1 Z is not ha's HH AA1 plus a Z", () => {
    expect(isDerived("has", isWord, readingsOf)).toBe(false);
  });

  it("leaves gas native, on the same vowel contrast", () => {
    expect(isDerived("gas", isWord, readingsOf)).toBe(false);
  });

  it("leaves a longer plural derived with no reading in sight", () => {
    // The guard only ever consulted spelling above three letters, and still
    // does: `downs` has no reading here and is derived all the same.
    expect(readingsOf("downs")).toEqual([]);
    expect(isDerived("downs", isWord, readingsOf)).toBe(true);
  });
});

describe("isDerived — native words carry their own rhyme content", () => {
  it.each(["down", "find", "mind", "blind", "taste", "waste"])(
    "treats the base word %j as native",
    (word) => {
      expect(isDerived(word, isWord, readingsOf)).toBe(false);
    },
  );
});
