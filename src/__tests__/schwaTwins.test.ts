/**
 * Schwa Twins: two Rhyme Keys that differ only by the optional schwa
 * immediately before a word-final syllabic `L`, `N` or `M` — the contrast
 * `normalise.ts`'s syllabic-consonant rule (ADR-0010) says a General American
 * listener cannot hear (issue #110). Curation groups such a pair as one
 * family; adjudication accepts a submission whose only reading lands on the
 * far side of the pair.
 *
 * `schwaTwinOf` is reasoned from the Rhyme Key string alone, using the same
 * restrictions `syllabicVariantsOf` (src/normalise.ts) applies to the full
 * reading: a `AH` at any position but the first in a Rhyme Key is provably
 * unstressed (`rhymeKeyOf` always starts a key at the *last* stressed vowel,
 * so nothing to its right can also be stressed), and "after a vowel, only `L`,
 * never after `IY`" is re-applied here against ARPABET's fixed vowel symbols,
 * since a Rhyme Key carries no stress digit to ask `isVowel` about.
 */

import { describe, expect, it } from "vitest";
import { schwaTwinOf } from "../schwaTwins.ts";

describe("schwaTwinOf", () => {
  it.each([
    ["EH SH AH N", "EH SH N"], // session
    ["EH K SH AH N", "EH K SH N"], // rejection / subsection
    ["AA JH IH K AH L", "AA JH IH K L"], // technological
    ["EY SH AH N AH L", "EY SH AH N L"], // operational (two AHs; only the last is touched)
    ["AH T AH N", "AH T N"], // button/mutton/glutton — schwa after a consonant
    ["UW L", "UW AH L"], // cool / gruel — vowel-preceded, but L absorbs it
  ])("links %j and %j both ways", (a, b) => {
    expect(schwaTwinOf(a)).toBe(b);
    expect(schwaTwinOf(b)).toBe(a);
  });

  it.each([
    ["AY N", "lion/line: nasal after a vowel does not reduce"],
    ["AY AH N", "lion, from the other side"],
    ["UW N", "moon: guards against twinning with ruin's UW AH N"],
    ["UW AH N", "ruin itself"],
    ["IY AH M", "museum: IY never absorbs the schwa, even before M"],
    ["EY AA N", "crayon: AA is a full vowel, never a schwa"],
  ])("refuses %j — %s", (key) => {
    expect(schwaTwinOf(key)).toBeNull();
  });

  it("never turns a stressed anchor AH into a bogus consonant-only key", () => {
    // "AH N" (sun, gun, fun): the AH here is the stressed anchor itself, not a
    // droppable schwa. Whatever this returns must not collide with any real
    // Rhyme Key — in particular it must not be the nonsensical single-token "N".
    expect(schwaTwinOf("AH N")).not.toBe("N");
  });

  it("is reversible: applying it twice returns the original key", () => {
    for (const key of ["EH SH AH N", "EH SH N", "UW L", "UW AH L", "AH T AH N", "AH T N"]) {
      const twin = schwaTwinOf(key);
      expect(twin).not.toBeNull();
      expect(schwaTwinOf(twin!)).toBe(key);
    }
  });
});
