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
 *       -> coverage derivation    readings composed from a stem (src/coverage.ts)
 *       -> normalisation          this stage: the accent specification
 *       -> Rhyme Index
 *
 * The ordering is load-bearing and is the contract a sibling epic builds
 * against. Normalisation runs last because the supplement asserts *readings*
 * while this stage asserts the *accent*: a hand-authored correction is an input
 * to the accent specification, never an exemption from it. Coverage derivation
 * produces readings too, so it sits on the supplement's side of the line — a
 * reading composed from `walked` arrives here with the unmerged vowel and is
 * merged like any other.
 *
 * Nothing downstream is aware this stage exists. Rhyme Key computation,
 * respelling, tiering, Puzzle building, adjudication and curation all receive
 * ordinary pronunciations; this is the only new seam.
 *
 * ## Adding a rule
 *
 * Each rule is named, and its docblock states the perceptual claim that
 * justifies it — so a reviewer can challenge the claim rather than the code, and
 * so dropping a rule from `RULES` measures its contribution. A rule is
 * admissible only if the contrast it erases is unavailable to a General American
 * listener *and* the guardrail table in
 * `src/__tests__/normalisation-guardrails.test.ts` survives intact (ADR-0010). A
 * rule may replace a reading or append a variant alongside it; which it does is
 * a decision recorded with the rule.
 */

import {
  bareSound,
  isVowel,
  rhymeKeyOf,
  stressOf,
  withSound,
  type Pronunciation,
} from "./phonology.ts";

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
  /** Rewrite one word's readings — replacing them, or appending variants. */
  apply(readings: readonly Pronunciation[]): Pronunciation[];
}

const CAUGHT_VOWEL = "AO";
const COT_VOWEL = "AA";
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
 * The pre-rhotic exclusion is not optional — most `AO` tokens in the playable
 * lexicon sit before `R`, and merging them too would make `for` rhyme with
 * `far`. ADR-0010 carries the measurement and how to reproduce it. Pre-lateral
 * position is deliberately *included* — `ball` rhymes with `doll`.
 */
const cotCaughtMerger: NormalisationRule = {
  name: "cot-caught-merger",
  apply: (readings) => readings.map(mergeCotCaught),
};

function mergeCotCaught(reading: Pronunciation): Pronunciation {
  return reading.map((phoneme, i) =>
    bareSound(phoneme) === CAUGHT_VOWEL && reading[i + 1] !== RHOTIC
      ? withSound(phoneme, COT_VOWEL)
      : phoneme,
  );
}

/** The schwa, and the sonorants that can carry a syllable without one. */
const SCHWA = "AH";
const SYLLABIFIABLE_SONORANTS = new Set(["L", "N", "M"]);

/** After a vowel, the one sonorant that absorbs the schwa. */
const VOWEL_ABSORBING_SONORANT = "L";

/** The one vowel that keeps its own syllable in front of the schwa. */
const UNABSORBING_VOWEL = "IY";

/**
 * Rule 2 — the syllabic consonant, the optional schwa before a final sonorant.
 *
 * A reading ending in an unstressed schwa followed by `L`, `N` or `M` gains a
 * second reading with the schwa gone and the consonant left syllabic. `gruel` is
 * `G R UW1 AH0 L` in the data and `G R UW1 L` out of most mouths; the two are
 * the same utterance at different speech rates, and a listener asked which one
 * they just heard cannot answer. The data picks one and the ear hears both, so
 * the game must read both — otherwise `gruel`, `duel`, `crewel` and `renewal`
 * are all refused for a Seed Word on `UW L`, which is four of the twelve queued
 * complaints this layer closes.
 *
 * This **appends** rather than replaces, and that is the whole of its safety
 * argument: the base reading survives, first and untouched, so the rule can only
 * turn a rejection into an acceptance. Unlike the merge, neither reading is
 * wrong — a two-syllable `gruel` is as real as a one-syllable one — so there is
 * no single reading to collapse to, and a Seed Word is still spoken and
 * respelled in the reading the data asserts.
 *
 * Four limits keep the claim honest, and each is the difference between a
 * contrast nobody can hear and one everybody can:
 *
 *   - **Only a schwa.** `AH0` alone. A full unstressed vowel is not reducible,
 *     so `crayon` (`K R EY1 AA0 N`) does not become `crane`. `ER0` is left out
 *     too, though it is reduced: it is *already* a syllabic consonant, and
 *     dropping it would turn `modern` into `M AA1 D N`. `IH0` is left out on the
 *     evidence discipline ADR-0010 applies throughout — no complaint turns on
 *     it, and admissibility is a floor, not a mandate.
 *   - **Only unstressed.** A stressed vowel is what a Rhyme Key hangs from, so
 *     dropping one would not restate a word's sound, it would erase it.
 *   - **Only at the very end of the reading.** The schwa in `chocolate` sits
 *     mid-word before an `L`, and dropping *that* is a claim about a different
 *     speech habit this rule does not make — which is what keeps the `-ate`
 *     guardrails out of reach, since none of them ends in a sonorant. The same
 *     limit costs the rule the inflections: `gruels` (`G R UW1 AH0 L Z`) keeps
 *     its schwa, because no complaint asks for it yet and every phoneme past
 *     the sonorant is a fresh claim about what stays audible.
 *   - **After a vowel, only `L`, and never after `IY`.** This limit was
 *     measured rather than reasoned. Unconstrained, the rule reached 99 words
 *     in the playable lexicon and got roughly half of them wrong, and the
 *     errors sorted themselves cleanly by what sits either side of the schwa.
 *
 *     A *consonant* before the schwa stays in the Rhyme Key and keeps it
 *     distinctive: `button` becomes `B AH1 T N`, key `AH T N`, which still
 *     picks out `mutton` and `glutton`. That is the textbook syllabic
 *     consonant and it is safe for all three sonorants.
 *
 *     A *vowel* before the schwa leaves a key just two phonemes long, so the
 *     word lands in whatever large family already owns it — and there the
 *     sonorant decides. `L` genuinely absorbs a preceding schwa: `cruel` is
 *     `/kruːl/`, `towel` `/taʊl/`, `trial` `/traɪl/`, `royal` `/rɔɪl/`. The
 *     nasals do not, which is why the unconstrained rule had `ruin` rhyming
 *     with `moon`, `urine` with `burn`, `protozoan` with `bone` and
 *     `jeroboam` with `home`. All 18 such words were wrong; all 33 in `L`
 *     were right.
 *
 *     `IY` is then excluded even before `L`, because unlike the offglide
 *     vowels it is a full front vowel holding its own syllable, and the schwa
 *     after it survives into casual speech: `museum` would otherwise rhyme
 *     with `dream`, `librarian` with `green`, `serial` with `feel`.
 *
 * Together those limits leave 35 words in the playable lexicon gaining a new
 * Rhyme Key, down from 99. The widest the perceptual claim now goes is `trial`
 * rhyming with `mile` and `betrayal` with `pale` — stated here rather than
 * hidden, so a reviewer who hears two syllables where this rule hears one is
 * challenging the claim, which is the argument worth having. `lion` is *not*
 * reached: it is a nasal after a vowel, so the schwa stays.
 *
 * A word with a droppable schwa ends up with two Rhyme Keys and so reads as
 * ambiguous, which bars it from being a Seed Word without an explicit key.
 * Accepted: the affected words are ones the game was previously getting wrong as
 * Submissions, and Seed Words are curated by hand anyway (ADR-0004).
 */
const syllabicConsonant: NormalisationRule = {
  name: "syllabic-consonant",
  apply: (readings) => [...readings, ...readings.flatMap(syllabicVariantsOf)],
};

/** The syllabic reading of one reading, or none if the schwa is not droppable. */
function syllabicVariantsOf(reading: Pronunciation): Pronunciation[] {
  const sonorant = reading.at(-1);
  const schwa = reading.at(-2);
  if (sonorant === undefined || schwa === undefined) return [];
  if (!SYLLABIFIABLE_SONORANTS.has(sonorant)) return [];
  if (bareSound(schwa) !== SCHWA || stressOf(schwa) !== 0) return [];

  // After a vowel, only `L` absorbs the schwa, and not even `L` after `IY`.
  // After a consonant every sonorant does — see the fourth limit above.
  const preceding = reading.at(-3);
  if (preceding !== undefined && isVowel(preceding)) {
    if (sonorant !== VOWEL_ABSORBING_SONORANT) return [];
    if (bareSound(preceding) === UNABSORBING_VOWEL) return [];
  }

  // A variant with no stressed vowel left has no Rhyme Key, so it could never
  // match anything — carrying it would only bloat the index.
  const variant = [...reading.slice(0, -2), sonorant];
  return rhymeKeyOf(variant) === null ? [] : [variant];
}

/** Every rule, in application order. Dropping one here disables it wholesale. */
const RULES: readonly NormalisationRule[] = [cotCaughtMerger, syllabicConsonant];

/**
 * The readings of one word, after every rule. Duplicates are collapsed: a rule
 * that replaces can make two of a word's readings identical (CMUdict lists some
 * words both merged and unmerged), and a duplicate reading is a reading the
 * index would carry forever without it ever mattering.
 */
function normaliseReadings(readings: readonly Pronunciation[]): Pronunciation[] {
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
