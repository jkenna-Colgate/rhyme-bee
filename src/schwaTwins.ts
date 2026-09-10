/**
 * Schwa Twins: two Rhyme Keys that differ only by the optional schwa
 * immediately before a word-final syllabic `L`, `N` or `M` — the contrast
 * `normalise.ts`'s syllabic-consonant rule (ADR-0010) says a General American
 * listener cannot hear. `session` (`EH SH AH0 N`) gains an appended reading
 * without the schwa (`EH SH N`), so it ends up pinned to two Rhyme Keys for
 * one sound. Curation used to see those as two unrelated families and two
 * candidate Seed Words for what is one Puzzle (issue #110).
 *
 * Reasoned from the Rhyme Key string alone, mirroring the restrictions
 * `syllabicVariantsOf` applies to the full reading there:
 *
 *   - A `AH` at any position but the first in a Rhyme Key is *provably*
 *     unstressed. `rhymeKeyOf` always starts a key at the last (rightmost)
 *     stressed vowel in the pronunciation, so nothing to the right of that
 *     start can also be stressed — if it were, the key would have started
 *     there instead. So a "AH" past position 0 can only be the reducible
 *     schwa, never the stressed vowel a Rhyme Key hangs from.
 *   - "After a vowel, only `L` absorbs the schwa, and not even `L` after an
 *     unabsorbing vowel" is re-applied here against ARPABET's fixed
 *     vowel-symbol set, since a Rhyme Key strips every stress digit and so
 *     carries nothing `isVowel` (phonology.ts) could read.
 *   - "Never after a liquid" (#209) is re-applied the same way. A Rhyme Key
 *     does carry the `L` or `R` before the schwa, so unlike a stress-based
 *     limit this one is expressible on both sides of the rule — which is what
 *     makes it a fix at all. `AO R AH M` (`forum`) must not twin with `AO R M`
 *     (`storm`), and nothing but this restriction stops it.
 *
 * Skipping either restriction is not a rounding error: without it, `AY N`
 * (`mine`, `line`) would twin with `AY AH N` (`lion`) and `UW N` (`moon`)
 * would twin with `UW AH N` (`ruin`) — exactly the false rhymes
 * `syllabic-consonant.test.ts`'s guardrails exist to refuse.
 *
 * `SCHWA`, `SYLLABIFIABLE_SONORANTS`, `VOWEL_ABSORBING_SONORANT`,
 * `UNABSORBING_VOWELS` and `LIQUIDS` restate five literals `normalise.ts`'s `syllabicConsonant`
 * rule already owns. They are not imported from there because reading manufacture
 * is frozen (ADR-0011) and nothing in that freeze offers a seam to import
 * through — the rule's constants are private to the module reading the
 * *Pronunciation*, stress digits included, while this file reasons from the
 * *Rhyme Key* string, stress digits already gone. Restated, not reused: if the
 * frozen rule is ever amended, this file's restriction needs the same look.
 */

import { isVowelSound, type RhymeKey } from "./phonology.ts";

/** The schwa, and the sonorants that can carry a syllable without one. */
const SCHWA = "AH";
const SYLLABIFIABLE_SONORANTS = new Set(["L", "N", "M"]);

/** After a vowel, the one sonorant that absorbs the schwa. */
const VOWEL_ABSORBING_SONORANT = "L";

/** The vowels that keep their own syllable in front of the schwa (#209). */
const UNABSORBING_VOWELS = new Set(["IY", "ER", "EY"]);

/** The liquids, which keep their own syllable there too (#209). */
const LIQUIDS = new Set(["L", "R"]);

/** True if the sound immediately before the schwa blocks this pair from twinning. */
function blockedByPreceding(preceding: string, sonorant: string): boolean {
  if (isVowelSound(preceding)) {
    return sonorant !== VOWEL_ABSORBING_SONORANT || UNABSORBING_VOWELS.has(preceding);
  }
  return LIQUIDS.has(preceding);
}

/**
 * The other Rhyme Key in `key`'s Schwa Twin pair, or null if `key` has no
 * legitimate one. Works from either side: given the schwa-ful key it returns
 * the schwa-less one, and vice versa. Reversible — `schwaTwinOf(schwaTwinOf(k))
 * === k` whenever the first call returns non-null — because both directions
 * apply the identical restriction to the identical "preceding" phoneme.
 */
export function schwaTwinOf(key: RhymeKey): RhymeKey | null {
  const parts = key.split(" ");
  const sonorant = parts.at(-1);
  if (sonorant === undefined || !SYLLABIFIABLE_SONORANTS.has(sonorant)) return null;

  const beforeSonorant = parts.at(-2);
  if (beforeSonorant === undefined) return null;

  // A schwa can only ever sit here when it is not the key's first (anchor)
  // element — anything after the anchor is provably unstressed (see above).
  if (beforeSonorant === SCHWA && parts.length >= 3) {
    const preceding = parts.at(-3)!;
    if (blockedByPreceding(preceding, sonorant)) return null;
    return [...parts.slice(0, -2), sonorant].join(" ");
  }

  // Otherwise `key` is the schwa-less candidate: the same restriction applies
  // to whatever precedes the sonorant now, the anchor vowel included.
  const preceding = beforeSonorant;
  if (blockedByPreceding(preceding, sonorant)) return null;
  return [...parts.slice(0, -1), SCHWA, sonorant].join(" ");
}
