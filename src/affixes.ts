/**
 * The affix inventory the coverage derivation stage reads — **plain configured
 * data**, so widening coverage is a data change, not a code change.
 *
 * An `AffixRule` answers two questions about a word with no reading of its own:
 * *which known stems could it be built from*, and *what reading does that stem's
 * reading compose into*. The two are kept apart from the candidate set in
 * `src/coverage.ts` so a new affix is added here and nowhere else.
 *
 * ## Prefixes, and why they came first
 *
 * The Rhyme Key runs from a word's last stressed vowel to the end (ADR-0001),
 * and that vowel always lies in the stem. A prefix's phonemes therefore sit
 * entirely outside the key: they change the respelling a player is shown and
 * nothing about the verdict. `prefixRule` asserts exactly that — a composition
 * whose Rhyme Key is not the stem's own is refused rather than stored — so the
 * claim is enforced, not merely believed.
 *
 * A prefix is never given primary stress. Respelling upper-cases the
 * primary-stressed syllable, so a stressed prefix would move the emphasis off
 * the rhyming stem and an accepted rhyme would stop reading as one. The
 * ARPABET below follows CMUdict's own prefixed entries (`unhappy AH0 N ...`,
 * `rethink R IY0 ...`), demoted to secondary stress where CMUdict marks primary.
 *
 * ## Adding an affix
 *
 * Add a `Prefix` to `PREFIXES` (a spelling and its phonemes) and it is live.
 * A suffix slice adds its own list and its own rule factory beside these; the
 * seam in `coverage.ts` takes `AFFIX_RULES` whole and does not care what is in
 * it. Rules are tried in the order `AFFIX_RULES` presents them, longest
 * spelling first, so `under-` is preferred over `un-` where both would fit —
 * the more specific segmentation wins.
 */

import { rhymeKeyOf, type Pronunciation } from "./phonology.ts";

/**
 * One way of building a word from a known stem. `stemsOf` proposes stems from
 * the spelling alone (a cheap, wide net — the caller keeps only those the
 * dictionary holds); `read` composes the reading, or returns null when the
 * composition would not be sound.
 */
export interface AffixRule {
  /** Stable identifier, named in the derived-words report, e.g. `prefix:un`. */
  name: string;
  /** Stems whose reading could compose `word`. Empty when the rule cannot apply. */
  stemsOf(word: string): string[];
  /** Compose one derived reading from one of the stem's readings, or null. */
  read(stemReading: Pronunciation): Pronunciation | null;
}

/** A prefix: its spelling, and the phonemes it contributes to the front. */
export interface Prefix {
  spelling: string;
  phonemes: Pronunciation;
}

/**
 * The shortest stem a prefix may be peeled back to. Two letters admits too much
 * — `re` + `ad`, `un` + `it` — and buys almost nothing, since a stem that short
 * is a common word CMUdict already carries a reading for.
 */
const MIN_STEM_LENGTH = 3;

/**
 * The configured prefixes — the single inventory, read by both the stage that
 * *composes* a prefixed reading and the detector that *recognises* a prefixed
 * word (`isDerived`, ADR-0008). One list matters now that this stage exists: a
 * prefix here gives a word a reading, which puts it in a Rhyme Key family, and
 * a detector that did not know the same prefix would score that word as native
 * and let a Shadow Key back into the Seed pool.
 *
 * Each is stress-neutral on its stem: it adds syllables in front and leaves the
 * stem's own stress where it was. Order here is immaterial — `AFFIX_RULES`
 * sorts by spelling length.
 */
export const PREFIXES: readonly Prefix[] = [
  { spelling: "un", phonemes: ["AH0", "N"] },
  { spelling: "re", phonemes: ["R", "IY0"] },
  { spelling: "out", phonemes: ["AW2", "T"] },
  { spelling: "over", phonemes: ["OW2", "V", "ER0"] },
  { spelling: "mis", phonemes: ["M", "IH0", "S"] },
  { spelling: "non", phonemes: ["N", "AA2", "N"] },
  { spelling: "under", phonemes: ["AH2", "N", "D", "ER0"] },
  { spelling: "inter", phonemes: ["IH2", "N", "T", "ER0"] },
  { spelling: "pre", phonemes: ["P", "R", "IY0"] },
  { spelling: "dis", phonemes: ["D", "IH0", "S"] },
  { spelling: "sub", phonemes: ["S", "AH2", "B"] },
  { spelling: "mid", phonemes: ["M", "IH2", "D"] },
  { spelling: "post", phonemes: ["P", "OW2", "S", "T"] },
  { spelling: "self", phonemes: ["S", "EH2", "L", "F"] },
  { spelling: "semi", phonemes: ["S", "EH2", "M", "IY0"] },
  { spelling: "anti", phonemes: ["AE2", "N", "T", "AY0"] },
  { spelling: "multi", phonemes: ["M", "AH2", "L", "T", "IY0"] },
  { spelling: "super", phonemes: ["S", "UW2", "P", "ER0"] },
  { spelling: "counter", phonemes: ["K", "AW2", "N", "T", "ER0"] },
];

/** Just the spellings, for the callers that judge words rather than sounds. */
export const PREFIX_SPELLINGS: readonly string[] = PREFIXES.map((p) => p.spelling);

/**
 * Turn one configured prefix into a rule. The composition is refused when it
 * would move the Rhyme Key — which happens only when the stem has no stressed
 * vowel of its own, so the prefix's vowel would become the last stressed one
 * and the key would run through phonemes the stem never contributed.
 */
function prefixRule({ spelling, phonemes }: Prefix): AffixRule {
  return {
    name: `prefix:${spelling}`,
    stemsOf(word) {
      if (!word.startsWith(spelling)) return [];
      const stem = word.slice(spelling.length);
      return stem.length >= MIN_STEM_LENGTH ? [stem] : [];
    },
    read(stemReading) {
      const composed = [...phonemes, ...stemReading];
      const stemKey = rhymeKeyOf(stemReading);
      return stemKey !== null && rhymeKeyOf(composed) === stemKey ? composed : null;
    },
  };
}

/**
 * Every affix rule, in the order the derivation stage tries them. Longest
 * spelling first, so the most specific segmentation of a word wins: `underpay`
 * is `under` + `pay`, not `un` + `derpay`.
 */
export const AFFIX_RULES: readonly AffixRule[] = [...PREFIXES]
  .sort((a, b) => b.spelling.length - a.spelling.length || a.spelling.localeCompare(b.spelling))
  .map(prefixRule);
