/**
 * The derivation detector (ADR-0008): is a surface form a regular inflection or a
 * common-prefix affixation of a *dictionary* word, or does it carry native rhyme
 * content of its own? "Derived relative to other real words" is the whole idea,
 * so every case is asserted against an explicit little dictionary predicate.
 */

import { describe, expect, it } from "vitest";
import { isDerived } from "../lemmatise.ts";

// A tiny dictionary of bases. `isDerived` is derivation *relative to* this set:
// a word is derived only when a real base for it exists here.
const dictionary = new Set<string>([
  "down", "king", "book", "combine", "aid", "stand",
  "find", "mind", "blind", "taste", "waste", "read", "do",
]);
const isWord = (w: string): boolean => dictionary.has(w);

describe("isDerived — inflection pass", () => {
  it.each(["downs", "kings", "books"])(
    "treats the plural %j as derived from its base",
    (word) => {
      expect(isDerived(word, isWord)).toBe(true);
    },
  );

  it("treats a past-tense inflection as derived (combined ← combine)", () => {
    expect(isDerived("combined", isWord)).toBe(true);
  });

  it("treats a progressive inflection as derived (aiding ← aid)", () => {
    expect(isDerived("aiding", isWord)).toBe(true);
  });
});

describe("isDerived — prefix pass", () => {
  it("catches a prefix on an inflected base (unaided ← un + aided ← aid)", () => {
    // The base `aided` is itself an inflection of `aid`; without the prefix pass
    // `unaided` masquerades as native and its shadow key wrongly survives.
    expect(isDerived("unaided", isWord)).toBe(true);
  });

  it("catches a prefix on an inflected base (outstanding ← out + standing ← stand)", () => {
    expect(isDerived("outstanding", isWord)).toBe(true);
  });

  it("catches a prefix directly on a base word (redo ← re + do)", () => {
    expect(isDerived("redo", isWord)).toBe(true);
  });

  it("does not treat a prefix that merely starts the word as derivation (read: re + ad, no such base)", () => {
    expect(isDerived("read", isWord)).toBe(false);
  });
});

describe("isDerived — native words carry their own rhyme content", () => {
  it.each(["down", "find", "mind", "blind", "taste", "waste"])(
    "treats the base word %j as native",
    (word) => {
      expect(isDerived(word, isWord)).toBe(false);
    },
  );
});
