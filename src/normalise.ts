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
 *       -> committed demotions    hand-read wordhood corrections (src/demotions.ts)
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
 *
 * Where it sits in `RULES` is part of the decision too, and the order and the
 * reason for each place are written once, at `RULES`. Two things decide a
 * place. A rule that reads the stress digits sees different readings before and
 * after stress promotion, so its place relative to promotion is chosen, and an
 * append rule must run where its reach was measured. And the index tells an
 * appended reading from a transcribed one only by its shape
 * (`isGeneratedVariantOf` in src/rhymeIndex.ts): a replacing rule that runs
 * after an appending one rewrites the variant as well as the reading it came
 * from, and if the two are rewritten differently that recogniser has to be
 * taught the difference, or the variant is taken for a transcribed reading and
 * a Seed Word can be pinned to it.
 */

import {
  bareSound,
  isStressed,
  isVowel,
  lastStressedIndex,
  rhymeKeyOf,
  stressOf,
  withSound,
  withStress,
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
  /**
   * Filled by this stage, if given: surface form -> its readings unmerged, after
   * every rule but the `scoringOnly` ones, for each word those rules changed. It is
   * the reading a Weak Rhyme is worked out from (ADR-0020), which has to see the
   * weak vowel the dictionary wrote. A word absent here reads the same both ways.
   */
  unmergedReadings?: Map<string, Pronunciation[]>;
}

export interface NormalisationRule {
  /** Stable identifier, used in prose and when discussing the rule's effect. */
  name: string;
  /**
   * True for a rule that decides a Rhyme but must not reach the reading a Weak
   * Rhyme is worked out from (ADR-0020). The stage runs every rule for the
   * reading the index holds, and every rule but these for the unmerged reading
   * it keeps beside it (`NormalisationTarget.unmergedReadings`).
   */
  scoringOnly?: boolean;
  /** Rewrite one word's readings — replacing them, or appending variants. */
  apply(readings: readonly Pronunciation[]): Pronunciation[];
}

const CAUGHT_VOWEL = "AO";
const COT_VOWEL = "AA";
export const RHOTIC = "R";

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

/**
 * The vowels that keep their own syllable in front of the schwa (#209). `IY` is
 * the original member; `ER` and `EY` were added when the rule's reach was
 * measured over the words where it actually changes a rhyme verdict, rather
 * than over every word it rewrites.
 */
const UNABSORBING_VOWELS = new Set(["IY", "ER", "EY"]);

/**
 * The liquids, which keep their own syllable in front of the schwa the way an
 * unabsorbing vowel does (#209). A liquid is at least as sonorous as the
 * sonorant that would carry the syllable, so the schwa between them is the only
 * thing separating two syllable peaks and it stays audible.
 */
const LIQUIDS = new Set(["L", "R"]);

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
 * Five limits keep the claim honest, and each is the difference between a
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
 *     `IY`, `ER` and `EY` are then excluded even before `L`. Unlike the
 *     offglide vowels, each holds its own syllable, and the schwa after it
 *     survives into casual speech: `museum` would otherwise rhyme with
 *     `dream`, `librarian` with `green`, `serial` with `feel`, `liberal` and
 *     `femoral` with `curl`, `betrayal` and `portrayal` with `pale`. `IY` was
 *     the original member; `ER` and `EY` joined it in #209 (below).
 *
 *   - **Never after a liquid** (#209). `L` and `R` before the schwa block the
 *     drop whatever the sonorant is. A liquid is at least as sonorous as the
 *     sonorant that would carry the syllable, so the schwa between them is the
 *     only thing keeping two syllable peaks apart and it stays audible.
 *     Unmeasured, this was the larger half of #209: it put `forum` and
 *     `decorum` in the `storm` family, `foreign` and `baron` in `born`'s and
 *     `cairn`'s, `column` and `antebellum` in `calm`'s and `elm`'s.
 *
 * ## What the limits are measured against
 *
 * The figure that matters is not how many words the rule *rewrites* but how
 * many gain a **new rhyme partner**. For most words the whole family drops the
 * schwa together, so both Rhyme Keys hold the same members and no verdict
 * moves: `session`, `button`, `able`, `children` and `patron` all gain a
 * reading and no partner. Over the playable lexicon the rule rewrites 5,018
 * words and moves a verdict for 1,038 of them — `main` at `d17f082`, with
 * #209's two limits, in `docs/measurements/syllabic-consonant.md`.
 *
 * Almost none of that 1,038 is this rule's own reach. 1,005 of them (96.8%)
 * gain one of just eight partners, and seven of the eight carry a stress mark
 * that a sibling word in the same index contradicts: `coarticulation` is
 * marked `EY0` where `articulation` has `EY1`, and 872 of the 1,038 reach it.
 * The drop does not produce those rhymes. It manufactures a coda, stress
 * promotion fires on that coda (#86), and the promoted reading carries the
 * key. ADR-0018 deduces that correcting the stress in `data/supplement.dict`
 * would give the same verdicts without either rule, which is why reach here is
 * measured **net** of what a per-word correction produces anyway. Net, this
 * rule's population is 33 words, and the two limits above were tuned against
 * the gross figure, so they stand provisional (ADR-0018).
 *
 * The reach that is a genuine perceptual claim is the vowel branch. Its size
 * was last measured before #209 changed it, so no figure is stated here.
 *
 * The widest that claim now goes is `trial` rhyming with `mile` and
 * `withdrawal` with `wall` — stated here rather than hidden, so a reviewer who
 * hears two syllables where this rule hears one is challenging the claim,
 * which is the argument worth having. `lion` is *not* reached: it is a nasal
 * after a vowel, so the schwa stays.
 *
 * One residue is known and accepted. `UW` still absorbs at secondary stress, so
 * `spiritual`, `contextual`, `textual` and `unusual` keep a reading on `UW L`
 * and rhyme with `cool`. Cutting them means cutting `cruel` and `duel` with
 * them — the complaint this rule was built for — because a Rhyme Key strips
 * stress digits, so `schwaTwins.ts` cannot tell the two apart and no
 * stress-based limit is expressible on both sides of the rule (#209).
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

  // After a vowel, only `L` absorbs the schwa, and not after an unabsorbing
  // vowel. After a liquid nothing absorbs it. After any other consonant every
  // sonorant does — see the fourth and fifth limits above.
  const preceding = reading.at(-3);
  if (preceding !== undefined) {
    if (isVowel(preceding)) {
      if (sonorant !== VOWEL_ABSORBING_SONORANT) return [];
      if (UNABSORBING_VOWELS.has(bareSound(preceding))) return [];
    } else if (LIQUIDS.has(bareSound(preceding))) return [];
  }

  // A variant with no stressed vowel left has no Rhyme Key, so it could never
  // match anything — carrying it would only bloat the index.
  const variant = [...reading.slice(0, -2), sonorant];
  return rhymeKeyOf(variant) === null ? [] : [variant];
}

/**
 * The three vowels CMUdict uses for a *reduction*. Consulted only on a vowel the
 * data already marks unstressed, where each one is by definition the reduced
 * article: `AH0` is the schwa, `IH0` the reduced high front vowel, `ER0` the
 * r-coloured schwa. Every other vowel, unstressed, is a full vowel.
 */
const REDUCED_VOWELS = new Set([SCHWA, "IH", "ER"]);

/**
 * True for a coda that is only ever a regular inflection stuck on a vowel-final
 * stem: after a vowel the regular `-s` is voiced to `Z` and the regular `-ed` to
 * `D`, so a coda of exactly one of those is `arrow` + `s` rather than a closed
 * syllable. Anything longer holds a consonant of the stem before the ending.
 */
function isLoneInflectionalCoda(coda: Pronunciation): boolean {
  return coda.length === 1 && (coda[0] === "Z" || coda[0] === "D");
}

/**
 * Rule 3 — stress promotion, the full vowel in a closed final syllable.
 *
 * A reading whose final vowel is marked unstressed, is a full (non-reduced)
 * vowel, and is followed by at least one consonant gains a second reading with
 * that vowel marked *secondary* stress. `module` is `M AA1 JH UW0 L` in the data
 * and "MODJ-ool" out of every mouth; the contrast the game was rejecting it over
 * is a stress digit on a vowel it agrees is the same vowel — `UW0` against `UW2`
 * — and no listener can hear that. So `module`, `nodule`, `schedule` and
 * `ritual` were all refused for a Seed Word on `UW L`.
 *
 * This is the same claim ADR-0001 already rests on. `impregnate` rhymes with
 * `ate` on `EY2`, its secondary stress; `candidate` is `K AE1 N D AH0 D EY0 T`,
 * the identical syllable with a different digit, and was refused. The rule does
 * not loosen the Rhyme rule — it repairs the reading the rule is applied to.
 *
 * Like the syllabic consonant this **appends**, and that is the whole of its
 * safety argument: the base reading survives, first and untouched, so no
 * Submission the game used to accept is refused now.
 *
 * Three limits keep the claim honest. The first two are the substance of the
 * rule; the third was measured. Every figure below is over the playable lexicon
 * — every surface form in `data/cmudict.dict` that passes the wordhood gate and
 * is not a name, after the supplement, coverage derivation and rules 1 and 2 —
 * and mean rhyme-family size is the size of the family the *average word* sees.
 * Reproduce by ablating a limit and rebuilding; the raw data is uncommitted
 * (ADR-0003), so this cannot be a test in the suite. The figures are larger than
 * the ones quoted in the originating issue (54.6 rising to 485.6), which were
 * taken over a lexicon scoped before the supplement, coverage and rules 1 and 2;
 * these are the ones the implementation reproduces.
 *
 *   - **Never a word-final vowel.** Promoting one yields a Rhyme Key of a single
 *     phoneme, and the `-y` ending admitted that way is a catastrophe: dropping
 *     this limit alone takes mean rhyme-family size from 69.3 to 348.2, the
 *     largest key to 4,325 members — the bare key `IY`, every `-y` word rhyming
 *     with every other, `bury ~ smelly`, `deadly ~ illegality` — and the words
 *     gaining a key from 729 to 5,241. Requiring a following consonant is
 *     phonologically real rather than defensive: a full vowel in a *closed* final
 *     syllable is genuinely unreduced and stress-bearing, while a word-final
 *     unstressed vowel is the classic reduction position. A minimum key length
 *     would be the wrong fix — `high`/`buy`/`eye` is a legitimate one-phoneme key
 *     and must survive.
 *   - **Never a reduced vowel.** `AH0`, `IH0` and `ER0` are genuine schwas, and
 *     excluding them is what preserves the `chocolate` / `ate` rejection ADR-0001
 *     was built on — the one contrast in the guardrail table everybody hears.
 *     Dropping this limit alone reaches 19,926 words and a mean family size of
 *     537.8. It also leaves the hand-authored `bratwurst` correction
 *     (`ER0` -> `ER2`, ADR-0009) a deliberate judgement about one loanword rather
 *     than something this rule silently duplicates.
 *   - **Never a coda of one lone `Z` or `D`.** Measured, not reasoned, and the
 *     only limit here whose claim is morphological rather than about the ear —
 *     it does not say a contrast is inaudible, it says the first limit was
 *     leaking. With the first two in place the rule still reached 1,719 words and
 *     got about 945 of them wrong, and the errors sorted themselves by the coda:
 *     after a vowel the regular `-s` is always voiced to `Z` and the regular
 *     `-ed` always to `D`, so a lone one of those is an ending stuck on a word
 *     whose own final vowel *was* word-final — the reduction position the first
 *     limit refuses. Inflection does not license stress. `arrow` is `AE1 R OW0`,
 *     so `arrows` must not rhyme with `nose`; without the limit the rule had
 *     `cities` rhyming with `bees` (652 words in that one key), `married` with
 *     `deed` (84) and `values` with `shoes` (19). A coda of two consonants holds
 *     a consonant of the stem *before* the ending, so `modules` (`L Z`) is
 *     promoted where `arrows` (`Z`) is not.
 *
 *     The limit is bought, not free. It excludes 991 words, and about 45 of them
 *     would have been right: judged from the reading alone, `thyroid` and
 *     `married` are the same shape, so `thyroid ~ void`, `victimize ~ size`,
 *     `chloride ~ side` and `forehead ~ bed` stay refused. Deciding it properly
 *     means asking whether the word *is* an inflection, which `inflectionalVariants`
 *     in `src/inflections.ts` could answer — but a rule sees only readings, never
 *     the word, and widening that signature is a change to a seam other work
 *     builds on. Left as the follow-up it is.
 *
 * Together the three leave 729 words in the playable lexicon gaining a new Rhyme
 * Key across 211 keys, and mean rhyme-family size at 71.3 against a baseline of
 * 69.3 — the largest key grows by one member, from 872 to 873. Measured, not
 * enforced: no word in that lexicon gains its *first* Rhyme Key, because a
 * reading with no stressed vowel at all is a function word whose final vowel is a
 * schwa. The rule carries no guard for it, so a future reading could.
 * The bulk of the gain is `-ate` verbs and nouns joining `ate` (+61, `candidate`,
 * `phosphate`, `template`, `vibrate`), `-ule`/`-ual` joining `cool` (+42,
 * `module`, `schedule`, `ritual`), `-on` joining `on` (+35, `python`,
 * `decathlon`), `-man`/`-men` compounds joining `man` and `men` (+27,
 * `frenchman`, `craftsmen`), and a long tail of compounds the data under-marked:
 * `mushroom ~ room`, `earpiece ~ peace`, `zigzag ~ bag`, `metaphor ~ four`,
 * `provolone ~ bone`, `morphine ~ green`, `termite ~ bite`, `vortex ~ flex`.
 *
 * Two groups are stated rather than hidden, because a reviewer should be able to
 * challenge them:
 *
 *   - CMUdict transcribes the `-os` plurals with an `S` rather than a `Z`
 *     (`bimbos B IH1 M B OW0 S`), so those escape the coda limit and about 19 of
 *     them join the `dose` family. Blocking a lone `S` too would cost more than
 *     it saves — `earpiece`, `mongoose`, `birdhouse`, `invoice`, `biomass`,
 *     `sucrose`, `duress` — so the data error is left visible.
 *   - Composed with the syllabic consonant, the rule reaches a few `-yman`
 *     compounds (`clergyman`, `ferryman`, `assemblyman`) and small closed sets
 *     like `dutiful ~ undutiful`. Each lands in a key holding only words of its
 *     own shape, so the effect is confined to words that already shared a family.
 *
 * Appending is monotone for *adjudication* and only for adjudication. Each of
 * those 729 words now carries two Rhyme Keys, so it reads as ambiguous:
 * `isAmbiguous` flips, `pinSeed` demands an explicit key where it used to infer
 * one, and curation's `multiplePronunciations` flag lights up. That is a genuine
 * reversal, not an addition. Accepted on the same terms as the syllabic
 * consonant — the affected words are ones the game was getting wrong as
 * Submissions, and Seed Words are curated by hand (ADR-0004) — but it is the part
 * of this rule a caller can feel.
 */
const stressPromotion: NormalisationRule = {
  name: "stress-promotion",
  apply: (readings) => [...readings, ...readings.flatMap(promotedVariantsOf)],
};

/** The promoted reading of one reading, or none if its final vowel is not eligible. */
function promotedVariantsOf(reading: Pronunciation): Pronunciation[] {
  const vowelIndex = lastVowelIndex(reading);
  if (vowelIndex === null) return [];

  const vowel = reading[vowelIndex]!;
  if (stressOf(vowel) !== 0) return [];
  if (REDUCED_VOWELS.has(bareSound(vowel))) return [];

  // A word-final vowel sits in the reduction position, and a lone `Z` or `D` is
  // an inflection rather than a closed syllable — see the limits above.
  const coda = reading.slice(vowelIndex + 1);
  if (coda.length === 0) return [];
  if (isLoneInflectionalCoda(coda)) return [];

  const variant = [...reading];
  variant[vowelIndex] = withStress(vowel, 2);
  return [variant];
}

/** The index of the reading's last vowel, or null if it has none. */
function lastVowelIndex(reading: Pronunciation): number | null {
  for (let i = reading.length - 1; i >= 0; i--) {
    if (isVowel(reading[i]!)) return i;
  }
  return null;
}

/** The weak "ih" a reading may carry after its Rhyme Key's stressed vowel. */
const WEAK_IH = "IH";

/**
 * Rule 4: weak "ih" and weak "uh" are one sound in a scoring Rhyme
 * (ADR-0011, amendment of 2026-10-07; #260).
 *
 * After the stressed vowel that opens a reading's Rhyme Key, `IH0` is read as
 * `AH0`. The source dictionary writes the same unstressed ending both ways, and
 * no General American listener can recover which way it chose: `facility` has
 * one and `utility` the other, and so do the families of `abated` and
 * `annotated`, and of `collection` and `direction`. None of those families
 * joined before this rule. The claim, the maintainer's reading of a sample of
 * the merges, the reach and the guardrail argument are the ADR's.
 *
 * It **replaces**, like the cot–caught merger and for the same reason: the
 * respelling must show the merged vowel, and a word written both ways must not
 * become two Rhyme Keys over a vowel nobody hears (`annotated` was two before
 * this rule, and is one now). `AH0` is the survivor because it is the schwa.
 *
 * Only the Rhyme Key is touched. A weak vowel before the stressed one is no part
 * of any Rhyme, so `facility` keeps its first "uh" and `direction` its first
 * "ih". The position is read off the stress digits, which is what fixes its
 * place in the order (explained at `RULES`).
 *
 * **It must not reach the reading a Weak Rhyme is worked out from.** A Weak
 * Rhyme (ADR-0020, as narrowed on #232) sees the weak vowel the dictionary
 * wrote: `aspirin` for `win` is accepted and `muffin` is not. So this rule is
 * `scoringOnly`, and the stage keeps each reading it changed, unmerged, in
 * `NormalisationTarget.unmergedReadings`, served by
 * `RhymeIndex.unmergedReadingsOf`.
 */
const weakVowelMerge: NormalisationRule = {
  name: "weak-vowel-merge",
  scoringOnly: true,
  apply: (readings) => readings.map(mergeWeakVowels),
};

/**
 * One reading through this rule alone. Exported so the adjudicator can tell
 * which of a Seed Word's unmerged readings lie on its pinned Rhyme Key by the
 * rule itself rather than a restatement of it.
 */
export function mergeWeakVowels(reading: Pronunciation): Pronunciation {
  const stressed = lastStressedIndex(reading);
  if (stressed === null) return reading;
  return reading.map((phoneme, i) =>
    i > stressed && bareSound(phoneme) === WEAK_IH && stressOf(phoneme) === 0
      ? withSound(phoneme, SCHWA)
      : phoneme,
  );
}

/** The two consonants General American says as one tap, and the one it is written as. */
const TAP_SPELLINGS = new Set(["T", "D"]);
export const TAP = "D";
/** The vowel whose length is heard before t and d, so neither is tapped after it. */
const RAISED_GLIDE = "AY";
/** The weak vowels a syllabic n is written with. */
const SYLLABIC_N_VOWELS = new Set([SCHWA, WEAK_IH]);

/**
 * Rule 6: a t or d after a vowel or `r`, before a weak vowel, is one sound
 * (ADR-0011, amendment of 2026-10-16; #262).
 *
 * General American says both as the same quick tap, so `latter` and `ladder`,
 * `metal` and `medal`, `computer` and `ruder` sound alike, and so do `quarter`
 * and `disorder` after `r`, and `charity` and `parody` between two weak vowels.
 * Inside a reading's Rhyme Key, a `T` or `D` with a vowel or `R` before it and a
 * vowel after it is read as `D`. Every vowel after the one that opens the key is
 * unstressed, so the shape alone keeps a t or d at the end of a word or before a
 * stressed vowel as written: `seat` / `seed`, `eight` / `aid`, `attack` / `adapt`.
 * The contrast, the reach and the guardrails are the ADR's.
 *
 * Two places are left out, because the sound there is not the tap. After "eye",
 * where many speakers say the vowel of `writer` differently from the vowel of
 * `rider`; "ow" joins (`shouted` / `crowded`). And before a syllabic n, said
 * with a glottal stop: `button` / `sudden`, `curtains` / `burdens`.
 *
 * It **replaces**, and the tap is written `D`, so the respelling says "d"
 * (`water` is "WAH-dur"), after the `talked` / `docked` precedent. Appending
 * would give each affected word a second Rhyme Key that rhymes where the first
 * does not, and thirteen scheduled Seed Words would stop being heard one way.
 *
 * The syllabic consonant rule's appended reading keeps its t (`metal` read
 * "met-l"), which is harmless because the full reading carries the join; its
 * place in the order is explained at `RULES`. A Weak Rhyme sees it too: the
 * tap always opens the syllable after it, so it is never in the last
 * syllable's rime a Weak Rhyme compares.
 */
const tap: NormalisationRule = {
  name: "tap",
  apply: (readings) => readings.map(tapReading),
};

function tapReading(reading: Pronunciation): Pronunciation {
  const stressed = lastStressedIndex(reading);
  if (stressed === null) return reading;
  return reading.map((phoneme, i) => {
    if (i <= stressed || !TAP_SPELLINGS.has(phoneme)) return phoneme;
    const before = reading[i - 1]!;
    const after = reading[i + 1];
    if (!isVowel(before) && before !== RHOTIC) return phoneme;
    if (bareSound(before) === RAISED_GLIDE) return phoneme;
    if (after === undefined || !isVowel(after)) return phoneme;
    if (opensSyllabicN(reading, i + 1)) return phoneme;
    return TAP;
  });
}

/**
 * True if the weak vowel at `i` is the schwa of a syllabic n: an `AH0` or `IH0`
 * followed by `N` and then no vowel (`button`, `curtains`, `mutant`).
 */
function opensSyllabicN(reading: Pronunciation, i: number): boolean {
  if (!SYLLABIC_N_VOWELS.has(bareSound(reading[i]!))) return false;
  if (reading[i + 1] !== "N") return false;
  const next = reading[i + 2];
  return next === undefined || !isVowel(next);
}

/** The vowels that end in a glide, after which "er" and plain `r` are one sound. */
export const GLIDING_VOWELS = new Set(["AY", "AW", "OY"]);
export const WEAK_ER = "ER0";

/**
 * Rule 5: after "eye", "ow" or "oy", "er" and plain `r` are read as each other
 * (ADR-0011, amendment of 2026-10-07; #261).
 *
 * General American says `fire` and `hour` with one syllable or two, and the
 * source dictionary writes `fire`, `hour` and `flour` both ways, but `expire`
 * with plain `r` only and `higher` with "er" only, so `higher` did not rhyme
 * with `expire`. Where the stressed vowel that opens a reading's Rhyme Key is
 * `AY`, `AW` or `OY`, an `ER0` straight after it gains a reading with `R`, and
 * an `R` straight after it gains one with `ER0`. The reach, the error rate and
 * the guardrails are the ADR's.
 *
 * It **appends**, in both directions, so the dictionary's reading survives first
 * and untouched, and Rhyme keeps the substitution property: every word in the
 * `AY ER` family is in the `AY R` family and the reverse, so either key is the
 * same Puzzle. That holds only if the two directions act on the same words, so
 * neither skips an `r` or "er" that a vowel follows: `fiery` (`AY1 ER0 IY0`)
 * gains `AY1 R IY0` and `expiry` (`AY1 R IY0`) gains `AY1 ER0 IY0`, and each
 * scores for the other whichever is the Seed Word. The reverse direction before
 * a vowel adds no pair of rhyming words: `virus` gains `AY ER AH S`, whose
 * family is the `AY R AH S` family it already rhymes with. The variant sits
 * only on the Rhyme Key's opening vowel; a glide earlier in the word is no part
 * of any Rhyme.
 *
 * Nothing but those three vowels: `player` and `lower` keep clear of `hair` and
 * `lore`. Nor the `l` that would be its other half (`serial` for `meal`), which
 * the ADR decided not to write.
 *
 * The index recognises the variant by shape (`isGlideRVariantOf` in
 * src/rhymeIndex.ts), so a word the dictionary writes both ways (`fire`) pins
 * only on its first reading. Both keys are one Puzzle, so that costs nothing.
 * Its place in the order (last) is explained at `RULES`.
 */
const glideR: NormalisationRule = {
  name: "glide-r",
  apply: (readings) => [...readings, ...readings.flatMap(glideRVariantsOf)],
};

/** The reading with its post-glide "er" and `r` swapped, or none if it has neither. */
function glideRVariantsOf(reading: Pronunciation): Pronunciation[] {
  const stressed = lastStressedIndex(reading);
  if (stressed === null) return [];
  if (!GLIDING_VOWELS.has(bareSound(reading[stressed]!))) return [];

  const next = reading[stressed + 1];
  let swapped: string;
  if (next === WEAK_ER) swapped = RHOTIC;
  else if (next === RHOTIC) swapped = WEAK_ER;
  else return [];

  const variant = [...reading];
  variant[stressed + 1] = swapped;
  return [variant];
}

/** The stressed vowels before `r` that are written the way the second of each pair is. */
export const BEFORE_R_MERGES = new Map([
  ["IY", "IH"],
  ["EY", "EH"],
  ["UW", "UH"],
]);
/** The vowel that joins "eh" before `r` only when a vowel follows the `r`. */
const BEFORE_R_VOWEL_MERGES = new Map([["AE", "EH"]]);

/**
 * Rule 7: a stressed vowel before `r` is written one way (ADR-0011, amendment
 * of 2026-10-26; #263).
 *
 * The source dictionary writes one General American sound two ways before `r`:
 * `here` with "ee" and `near` with "ih", `poor` with "oo" and `tour` with "uu",
 * `menswear` with "ay" and `air` with "eh". Before `r` and a vowel it also
 * leaves `barbaric` on "a" where `generic` has "eh". A vowel carrying stress 1
 * or 2 directly before `R` is read as `IH` for `IY`, `EH` for `EY` and `UH` for
 * `UW`, wherever it sits in the word, and as `EH` for `AE` only when a vowel
 * follows the `R`, so `car` and `care` stay apart. An unstressed vowel before
 * `r` is left as written. The claim, the reach and the guardrails are the ADR's.
 *
 * `poor` / `pour` is not part of it: "uu" + r against "or" is split word by word
 * in General American, so `cure` and `core` stay two Puzzles.
 *
 * It **replaces**, so the respelling shows one vowel and `here` and `beer` stop
 * showing two ways, and it reaches a vowel stress promotion has just stressed
 * (`graybeard`'s `IY0 R D`, promoted to `IY2 R D`, joins `beard`); its place
 * in the order is explained at `RULES`. A Weak Rhyme sees it too:
 * the contrast is no more audible to a Weak Rhyme than to a Rhyme.
 */
const vowelBeforeR: NormalisationRule = {
  name: "vowel-before-r",
  apply: (readings) => readings.map(mergeVowelsBeforeR),
};

function mergeVowelsBeforeR(reading: Pronunciation): Pronunciation {
  return reading.map((phoneme, i) => {
    if (!isStressed(phoneme) || reading[i + 1] !== RHOTIC) return phoneme;
    const sound = bareSound(phoneme);
    const merged = BEFORE_R_MERGES.get(sound);
    if (merged !== undefined) return withSound(phoneme, merged);
    const after = reading[i + 2];
    const beforeVowel = BEFORE_R_VOWEL_MERGES.get(sound);
    if (beforeVowel !== undefined && after !== undefined && isVowel(after)) return withSound(phoneme, beforeVowel);
    return phoneme;
  });
}

/**
 * Every rule, in application order. Dropping one here disables it wholesale.
 *
 * The number in each rule's docblock is the order the rules were adopted
 * (ADR-0010, then ADR-0011's amendments), not the order they run in. They run:
 *
 *  1. `cotCaughtMerger` (replaces), first, so every later rule sees one
 *     low-back vowel.
 *  2. `syllabicConsonant` (appends).
 *  3. `weakVowelMerge` (replaces). After the syllabic rule, and it rewrites a
 *     syllabic variant exactly as it rewrites the reading the variant came
 *     from, so `isSyllabicConsonantVariantOf` still matches the pair. Before
 *     stress promotion, because it finds the Rhyme Key by the stress digits and
 *     a promoted variant must be a promotion of the merged reading, or
 *     `isStressPromotionVariantOf` could not tell it was appended.
 *  4. `tap` (replaces). After the syllabic rule, whose variant leaves its t with
 *     no vowel after it and so untapped: `isSyllabicConsonantVariantOf` allows a
 *     `T` in the variant against a `D` in the full reading. Before stress
 *     promotion, for the weak-vowel merge's reason.
 *  5. `stressPromotion` (appends).
 *  6. `vowelBeforeR` (replaces). After stress promotion, because promotion can
 *     stress the vowel before `r` (`graybeard`'s `IY0 R D` becomes `IY2 R D` and
 *     only then joins `beard`): `isStressPromotionVariantOf` allows the
 *     respelled vowel.
 *  7. `glideR` (appends), last, after stress promotion, because promotion can
 *     make the glide the Rhyme Key's opening vowel: `vampire` is written
 *     `AY0 R`, is promoted to `AY2 R`, and only then gains `AY2 ER0` and the
 *     `purifier` family. Promotion has nothing to act on in a variant this rule
 *     makes, whose last vowel is the stressed glide or `ER0`, and
 *     `vowelBeforeR` never touches the three glides, so nothing is lost.
 */
const RULES: readonly NormalisationRule[] = [
  cotCaughtMerger,
  syllabicConsonant,
  weakVowelMerge,
  tap,
  stressPromotion,
  vowelBeforeR,
  glideR,
];

/** Every rule that has shipped, by name, in application order. The Judge's prompt states each one (#266). */
export const NORMALISATION_NAMES: readonly string[] = RULES.map((rule) => rule.name);

/**
 * The readings of one word, after every rule. Duplicates are collapsed: a rule
 * that replaces can make two of a word's readings identical (CMUdict lists some
 * words both merged and unmerged), and a duplicate reading is a reading the
 * index would carry forever without it ever mattering.
 */
function normaliseReadings(
  readings: readonly Pronunciation[],
  rules: readonly NormalisationRule[] = RULES,
): Pronunciation[] {
  let out: Pronunciation[] = [...readings];
  for (const rule of rules) out = rule.apply(out);

  const seen = new Set<string>();
  return out.filter((reading) => {
    const key = reading.join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every rule a Weak Rhyme's reading goes through: all but the scoring-only ones. */
const UNMERGED_RULES = RULES.filter((rule) => !rule.scoringOnly);

/** True if two lists of readings are the same readings in the same order. */
function sameReadings(a: readonly Pronunciation[], b: readonly Pronunciation[]): boolean {
  return a.length === b.length && a.every((reading, i) => reading.join(" ") === b[i]!.join(" "));
}

/**
 * Run the normalisation stage over an index build's pronunciations, in place.
 * Called once by `manufactureIndexData`, after the committed supplement.
 */
export function applyNormalisation(target: NormalisationTarget): void {
  for (const [word, readings] of target.pronunciations) {
    const normalised = normaliseReadings(readings);
    if (target.unmergedReadings) {
      const unmerged = normaliseReadings(readings, UNMERGED_RULES);
      if (!sameReadings(unmerged, normalised)) target.unmergedReadings.set(word, unmerged);
    }
    target.pronunciations.set(word, normalised);
  }
}
