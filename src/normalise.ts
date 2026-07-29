/**
 * Perceptual normalisation: the build stage that stops the game adjudicating
 * contrasts a General American listener cannot hear (ADR-0010).
 *
 * CMUdict encodes contrasts at a finer resolution than the ear. Read literally,
 * every sub-perceptual distinction is promoted to a confident binary verdict —
 * which is why `talked` was rejected for `docked` over `AO` versus `AA`. This
 * stage rewrites the stored readings once, before any Rhyme Key is computed, so
 * the verdict and the respelling are derived from the same reading and cannot
 * disagree.
 *
 * ## Where this sits in the index build
 *
 *     pinned upstream inputs      data/cmudict.dict, words.txt, names.txt
 *       -> committed supplement   hand-authored readings (ADR-0009)
 *       -> coverage derivation    not built yet — it inserts *here*
 *       -> normalisation          this stage: the accent specification
 *       -> Rhyme Index
 *
 * The ordering is load-bearing and is the contract a sibling epic builds
 * against. Normalisation runs last because the supplement asserts *readings*
 * while this stage asserts the *accent*: a hand-authored correction is an input
 * to the accent specification, never an exemption from it. Coverage derivation
 * produces readings too, so it belongs on the supplement's side of the line.
 *
 * Nothing downstream is aware this stage exists. Rhyme Key computation,
 * respelling, tiering, Puzzle building, adjudication and curation all receive
 * ordinary pronunciations; this is the only new seam.
 *
 * ## Adding a rule
 *
 * Each rule is named and carries the perceptual claim that justifies it, so a
 * reviewer can challenge the claim rather than the code, and so dropping one
 * from `RULES` measures its contribution. A rule is admissible only if the
 * contrast it erases is unavailable to a General American listener *and* the
 * guardrail table in `src/__tests__/normalisation-guardrails.test.ts` survives
 * intact (ADR-0010). A rule may replace a reading or append a variant alongside
 * it; which it does is a decision recorded with the rule.
 */

import { bareSound, type Phoneme, type Pronunciation } from "./phonology.ts";

/**
 * The part of the index build's data this stage touches — the same
 * `pronunciations` map the supplement writes to, mutated in place. Wordhood and
 * names are deliberately absent: normalisation restates how a word sounds, and
 * never makes something a word or stops it being one.
 */
export interface NormalisationTarget {
  /** Surface form -> its pronunciations (mutated in place). */
  pronunciations: Map<string, Pronunciation[]>;
}

export interface NormalisationRule {
  /** Stable identifier, used in prose and when discussing the rule's effect. */
  name: string;
  /** The perceptual claim that justifies erasing the contrast. */
  claim: string;
  /** Rewrite one word's readings — replacing them, or appending variants. */
  apply(readings: readonly Pronunciation[]): Pronunciation[];
}

const LOW_BACK_VOWEL = "AO";
const MERGED_LOW_BACK_VOWEL = "AA";
const RHOTIC = "R";

/**
 * Rule 1 — the cot–caught merger, the vowel of *merged* General American.
 *
 * `AO` becomes `AA` everywhere except immediately before `R`. This **replaces**
 * the reading rather than appending a variant, which is what makes an accepted
 * rhyme read as a rhyme: the respelling layer renders `AA` as "ah" and `AO` as
 * "aw", so a merged word must carry the merged vowel in the reading itself or
 * the screen shows two vowels while the verdict calls them one sound. Replacing
 * also keeps `talked` a single-Rhyme-Key word, rather than an accidental
 * homograph that `pinSeed` would demand be disambiguated.
 *
 * The pre-rhotic exclusion is not optional: 55% of all `AO` tokens in the
 * playable lexicon sit before `R`, and a blanket merge takes the `far` family
 * from 104 members to 236, admitting `for`, `car` and `jar` as rhymes for one
 * another. Pre-lateral position is deliberately *included* — `ball` rhymes with
 * `doll`.
 */
export const mergedLowBackVowel: NormalisationRule = {
  name: "merged-low-back-vowel",
  claim:
    "A merged General American listener does not hear cot–caught, so `talked` " +
    "and `docked` share a vowel. Before R the contrast survives, so `for` and " +
    "`far` do not.",
  apply: (readings) => readings.map(mergeLowBackVowels),
};

function mergeLowBackVowels(reading: Pronunciation): Pronunciation {
  return reading.map((phoneme, i) =>
    bareSound(phoneme) === LOW_BACK_VOWEL && reading[i + 1] !== RHOTIC
      ? withSound(phoneme, MERGED_LOW_BACK_VOWEL)
      : phoneme,
  );
}

/** Swap a vowel's sound, keeping its stress digit: `AO1` -> `AA1`. */
function withSound(phoneme: Phoneme, sound: string): Phoneme {
  return sound + phoneme.slice(bareSound(phoneme).length);
}

/** Every rule, in application order. Dropping one here disables it wholesale. */
export const RULES: readonly NormalisationRule[] = [mergedLowBackVowel];

/**
 * The readings of one word, after every rule. Duplicates are collapsed: a rule
 * that replaces can make two of a word's readings identical (CMUdict lists some
 * words both merged and unmerged), and a duplicate reading is a reading the
 * index would carry forever without it ever mattering.
 */
export function normaliseReadings(readings: readonly Pronunciation[]): Pronunciation[] {
  let out: Pronunciation[] = [...readings];
  for (const rule of RULES) out = rule.apply(out);

  const seen = new Set<string>();
  return out.filter((reading) => {
    const key = reading.join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Run the normalisation stage over an index build's pronunciations, in place.
 * Called once by `scripts/build-index.ts`, after the committed supplement.
 */
export function applyNormalisation(target: NormalisationTarget): void {
  for (const [word, readings] of target.pronunciations) {
    target.pronunciations.set(word, normaliseReadings(readings));
  }
}
