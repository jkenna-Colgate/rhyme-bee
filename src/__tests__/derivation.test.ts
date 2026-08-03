/**
 * The derivation detector (ADR-0008): is a surface form a regular inflection or a
 * common-prefix affixation of a *dictionary* word, or does it carry native rhyme
 * content of its own? "Derived relative to other real words" is the whole idea,
 * so every case is asserted against an explicit little dictionary.
 *
 * The rule is reached through the `Derivation` seam, and the seam is exercised
 * through both its adapters: a hand-built test double here, and the Rhyme
 * Index's own adapter via a fixture index below. Wordhood and readings arrive
 * together on one source, so a caller cannot pair a word list with somebody
 * else's readings.
 */

import { describe, expect, it } from "vitest";
import { makeShortPluralIndex } from "../__fixtures__/shortPlurals.ts";
import { Derivation, type DerivationSource } from "../derivation.ts";
import type { Pronunciation } from "../phonology.ts";

// A tiny dictionary of bases. Derivation is *relative to* this set: a word is
// derived only when a real base for it exists here.
const dictionary = new Set<string>([
  "down", "king", "book", "combine", "aid", "stand",
  "find", "mind", "blind", "taste", "waste", "read", "do",
  // The three-letter `-s` forms and their candidate bases (issue #97). Whether
  // each is an inflection is settled by the readings below, not by this list.
  "ups", "up", "has", "ha", "gas", "ga",
  // `inn` reaches `in` by de-doubling, a candidate the plural rule never made.
  "inn", "in",
]);

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
  ["inn", [["IH1", "N"]]],
  ["in", [["IH1", "N"]]],
]);

/** The test double: one adapter onto the seam, holding both lookups itself. */
class StubSource implements DerivationSource {
  readonly #words: ReadonlySet<string>;
  readonly #readings: ReadonlyMap<string, Pronunciation[]>;

  constructor(
    words: ReadonlySet<string>,
    readings: ReadonlyMap<string, Pronunciation[]>,
  ) {
    this.#words = words;
    this.#readings = readings;
  }

  hasWord(word: string): boolean {
    return this.#words.has(word);
  }

  readingsOf(word: string): Pronunciation[] {
    return this.#readings.get(word) ?? [];
  }
}

const derivation = new Derivation(new StubSource(dictionary, readings));
/** The behaviour before the sound test: no reading, so no `-s` base agrees. */
const withoutReadings = new Derivation(new StubSource(dictionary, new Map()));

describe("isDerived — inflection pass", () => {
  it.each(["downs", "kings", "books"])(
    "treats the plural %j as derived from its base",
    (word) => {
      expect(derivation.isDerived(word)).toBe(true);
    },
  );

  it("treats a past-tense inflection as derived (combined ← combine)", () => {
    expect(derivation.isDerived("combined")).toBe(true);
  });

  it("treats a progressive inflection as derived (aiding ← aid)", () => {
    expect(derivation.isDerived("aiding")).toBe(true);
  });
});

describe("isDerived — prefix pass", () => {
  it("catches a prefix on an inflected base (unaided ← un + aided ← aid)", () => {
    // The base `aided` is itself an inflection of `aid`; without the prefix pass
    // `unaided` masquerades as native and its shadow key wrongly survives.
    expect(derivation.isDerived("unaided")).toBe(true);
  });

  it("catches a prefix on an inflected base (outstanding ← out + standing ← stand)", () => {
    expect(derivation.isDerived("outstanding")).toBe(true);
  });

  it("catches a prefix directly on a base word (redo ← re + do)", () => {
    expect(derivation.isDerived("redo")).toBe(true);
  });

  it("does not treat a prefix that merely starts the word as derivation (read: re + ad, no such base)", () => {
    expect(derivation.isDerived("read")).toBe(false);
  });
});

describe("isDerived — a three-letter plural, when the sound agrees (issue #97)", () => {
  it("treats ups as derived: AH1 P S is up's reading plus a final S", () => {
    expect(derivation.isDerived("ups")).toBe(true);
  });

  it("leaves has native: HH AE1 Z is not ha's HH AA1 plus a Z", () => {
    expect(derivation.isDerived("has")).toBe(false);
  });

  it("leaves gas native, on the same vowel contrast", () => {
    expect(derivation.isDerived("gas")).toBe(false);
  });

  it("leaves a three-letter word that is not an `-s` form exactly as it was", () => {
    // `inn` reaches `in` by de-doubling, not by the plural rule, and always
    // did. The sound test is about the base an `-s` form gains, so it must not
    // reach a candidate no `-s` ever produced — `IH1 N` is not `IH1 N` + Z.
    expect(derivation.isDerived("inn")).toBe(true);
    expect(withoutReadings.isDerived("inn")).toBe(true);
  });

  it("leaves a longer plural derived with no reading in sight", () => {
    // The guard only ever consulted spelling above three letters, and still
    // does: `downs` has no reading here and is derived all the same.
    expect(derivation.lemmaCandidates("downs")).toContain("down");
    expect(derivation.isDerived("downs")).toBe(true);
  });
});

describe("isDerived — native words carry their own rhyme content", () => {
  it.each(["down", "find", "mind", "blind", "taste", "waste"])(
    "treats the base word %j as native",
    (word) => {
      expect(derivation.isDerived(word)).toBe(false);
    },
  );
});

describe("the same rule, reached through the Rhyme Index's own adapter", () => {
  // The second adapter. The short-plural fixture is the slice built for this
  // rule, so the verdicts it yields must match the double's, word for word.
  const { derivation: indexDerivation } = makeShortPluralIndex();

  it.each(["ups", "ins", "els"])(
    "treats %j as derived, because the sound agrees",
    (word) => {
      expect(indexDerivation.isDerived(word)).toBe(true);
    },
  );

  it.each(["has", "gas"])("leaves %j native, because the vowel disagrees", (word) => {
    expect(indexDerivation.isDerived(word)).toBe(false);
  });

  it("offers the sound-agreeing base as a lemma candidate", () => {
    expect(indexDerivation.lemmaCandidates("ups")).toContain("up");
  });

  it("withholds a base the sound refuses", () => {
    expect(indexDerivation.lemmaCandidates("has")).not.toContain("ha");
  });
});
