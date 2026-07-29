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
 * ## Suffixes, and why they are riskier
 *
 * A suffix's phonemes land *inside* the Rhyme Key. The key runs from the last
 * stressed vowel to the end of the word, and a **stress-neutral** suffix leaves
 * that vowel in the stem, so the key runs on through the suffix: `abolisher` is
 * `AA L IH SH ER`, not `abolish`'s `AA L IH SH`. A wrong suffix reading is
 * therefore a wrong rhyme verdict, where a wrong prefix reading is only a wrong
 * respelling. `suffixRule` enforces the stress-neutrality claim rather than
 * trusting it: a composition whose key is not the stem's key *extended* is
 * refused, which is exactly what happens if a configured suffix ever carries a
 * stressed vowel of its own.
 *
 * Only suffixes that meet that bar are configured. `-hood`, `-ship`, `-wise`,
 * `-like` and `-ism` all take secondary stress in CMUdict's own entries
 * (`childhood HH UH2 D`), and `-ity`, `-able` and `-ist` move the stem's stress
 * (`admire`/`admirable`, `biology`/`biologist`) — none is stress-neutral, so
 * none is here.
 *
 * ## Adding an affix
 *
 * Add a `Prefix` to `PREFIXES` or a `Suffix` to `SUFFIXES` — a spelling and its
 * phonemes — and it is live. The seam in `coverage.ts` takes `AFFIX_RULES` whole
 * and does not care what is in it. Rules are tried in the order `AFFIX_RULES`
 * presents them, longest spelling first, so `under-` is preferred over `un-` and
 * `-ness` over `un-` where both would fit — the more specific segmentation wins.
 */

import {
  isVowel,
  rhymeKeyOf,
  stressOf,
  type Phoneme,
  type Pronunciation,
} from "./phonology.ts";

/**
 * One way of building a word from a known stem. `stemsOf` proposes stems from
 * the spelling alone (a cheap, wide net — the caller keeps only those the
 * dictionary holds); `admits` judges the stem's reading *set* as a whole; `read`
 * composes one reading, or returns null when the composition would not be sound.
 */
export interface AffixRule {
  /** Stable identifier, named in the derived-words report, e.g. `prefix:un`. */
  name: string;
  /** Stems whose reading could compose `word`. Empty when the rule cannot apply. */
  stemsOf(word: string): string[];
  /**
   * Whether the affix may be composed onto a stem the build reads *this* set of
   * ways — asked once per stem, before any reading is composed, so a rule can
   * refuse a stem whose readings are really two different words.
   */
  admits(stemReadings: readonly Pronunciation[]): boolean;
  /** Compose one derived reading from one of the stem's readings, or null. */
  read(stemReading: Pronunciation): Pronunciation | null;
}

/** A prefix: its spelling, and the phonemes it contributes to the front. */
export interface Prefix {
  spelling: string;
  phonemes: Pronunciation;
}

/** A suffix: its spelling, and the phonemes it contributes to the end. */
export interface Suffix {
  spelling: string;
  phonemes: Pronunciation;
}

/**
 * The shortest stem an affix may be peeled back to. Two letters admits too much
 * — `re` + `ad`, `un` + `it`, `at` + `-est` — and buys almost nothing, since a
 * stem that short is a common word CMUdict already carries a reading for.
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
    // A prefix takes any stem, however many ways it reads. Its phonemes sit
    // outside the Rhyme Key, so every derived reading carries one of the stem's
    // *own* keys — and `misread` genuinely reads both ways, like `read` (#76).
    admits: () => true,
    read(stemReading) {
      const composed = [...phonemes, ...stemReading];
      const stemKey = rhymeKeyOf(stemReading);
      return stemKey !== null && rhymeKeyOf(composed) === stemKey ? composed : null;
    },
  };
}

/**
 * The configured suffixes. Every one is stress-neutral — it adds unstressed
 * syllables and leaves the stem's stress where it was — which is the entire
 * reason this class is safe to derive mechanically.
 *
 * The phonemes are **not** invented: each is the reading CMUdict gives the
 * suffix in the clear majority of its own entries, measured over every
 * dictionary word carrying the suffix whose stem the dictionary also holds. Where
 * CMUdict is internally inconsistent it is inconsistent about the *quality of an
 * unstressed vowel* and nothing else — `abruptness` is `N AH0 S` but `cleanness`
 * is `N IH0 S`, `biggest` is `AH0 S T` but `boldest` is `IH0 S T` — so the
 * majority is taken and the minority left as the pre-existing dictionary noise
 * it is. (Those pairs already fail to rhyme with each other in the shipped
 * index; that is a normalisation question, ADR-0010, not a derivation one.)
 *
 * Unlike `PREFIXES`, this list is deliberately *not* read by the derivation
 * detector `isDerived` (ADR-0008). The prefix list has to be shared because a
 * prefixed word lands in its stem's *own* Rhyme Key, so a detector blind to the
 * prefix would score it as native content and let a Shadow Key stand as a Seed.
 * A suffixed word lands in a different key from its stem — the suffix is inside
 * the key — so it cannot inflate the stem's key. Whether a key made *entirely* of
 * suffixed words is itself a Shadow Key is a fresh question for ADR-0008, which
 * names inflections and prefixes; measured against the pinned data it is not yet a
 * live one, because none of the 2,505 keys this slice creates reaches the playable
 * Answer band (the largest has 14 members, the band starts at 20).
 *
 * Order here is immaterial — `AFFIX_RULES` sorts by spelling length.
 */
export const SUFFIXES: readonly Suffix[] = [
  { spelling: "ly", phonemes: ["L", "IY0"] },
  { spelling: "ness", phonemes: ["N", "AH0", "S"] },
  { spelling: "er", phonemes: ["ER0"] },
  { spelling: "est", phonemes: ["AH0", "S", "T"] },
  { spelling: "ing", phonemes: ["IH0", "NG"] },
  { spelling: "ish", phonemes: ["IH0", "SH"] },
  { spelling: "ful", phonemes: ["F", "AH0", "L"] },
  { spelling: "less", phonemes: ["L", "AH0", "S"] },
  { spelling: "ment", phonemes: ["M", "AH0", "N", "T"] },
];

/** True when the two phonemes are the same consonant — a geminate at the seam. */
function geminates(stemEnd: Phoneme | undefined, suffixStart: Phoneme): boolean {
  return stemEnd === suffixStart && !isVowel(suffixStart);
}

/**
 * Compose a stem's reading with a suffix's phonemes, **degeminating** the seam:
 * where the suffix's first phoneme repeats the stem's last, the two are one
 * sound and only one is written. `zestful` + `-ly` ends `... AH0 L IY0`, not
 * `... AH0 L L IY0`, and `stern` + `-ness` is `S T ER1 N AH0 S`. CMUdict's own
 * entries do this throughout — `carefully K EH1 R F AH0 L IY0` — and a scratch
 * prototype that skipped it put a doubled `L` in the Rhyme Key, which is a wrong
 * rhyme verdict and not a cosmetic slip.
 *
 * Consonants only. Two identical unstressed *vowels* are two syllables, not a
 * geminate: `murderer` really is `M ER1 D ER0 ER0`.
 */
function suffixed(stemReading: Pronunciation, phonemes: Pronunciation): Pronunciation {
  const [first, ...rest] = phonemes;
  if (first === undefined) return [...stemReading];
  return geminates(stemReading.at(-1), first)
    ? [...stemReading, ...rest]
    : [...stemReading, ...phonemes];
}

/**
 * The orthographic stem spellings a suffixed word could be built from, in the
 * fixed order they are tried. Determinism is the point: the first candidate the
 * build holds a reading for wins, so the same pinned inputs always compose the
 * same reading.
 *
 * The order follows English spelling, and it was measured against every CMUdict
 * word carrying one of the configured suffixes whose stem the dictionary also
 * holds (8,850 words):
 *
 *   1. **the stem with a silent `e` restored, then the bare stem** — but only
 *      for a *vowel*-initial suffix (`use` + `-er`, `hope` + `-ing`, `cute` +
 *      `-est`). English deletes a silent `e` before a vowel, so there the `e`
 *      spelling is the regular reading of the word and the bare stem the
 *      fallback; putting it first fixes 220 of the 858 words a bare-first order
 *      got wrong (`user` ← `us`, `cutest` ← `cut`, `taper` ← `tap`);
 *   2. **the bare stem, and nothing else**, for a *consonant*-initial suffix.
 *      English keeps the silent `e` there — `zestful` + `-ly`, `polite` +
 *      `-ness` — so there is none to restore, and offering one anyway was
 *      measured and dropped: every word it got wrong was a consonant-initial
 *      suffix landing on a coincidental spelling (`holly` ← `hole`, `chilly` ←
 *      `chile`, `harness` ← `hare`, `pureness` ← `puree`), and the handful it got
 *      right — `truly`, `duly`, `wholly` — are irregular contractions CMUdict
 *      already reads, so nothing needs to derive them;
 *   3. **the undoubled final consonant** — `big` + `-est`, `thin` + `-ness`
 *      spelled `thinness`, `yodel` + `-er` spelled `yodeller` (96% correct where
 *      it is the first match);
 *   4. **a terminal `i` restored to `y`** — `happy` + `-ness`, `happy` + `-er`
 *      (93% correct).
 *
 * `MIN_STEM_LENGTH` is applied to each *candidate*, not to the base the suffix
 * was stripped from: `use` + `-er` is a three-letter stem reached from a
 * two-letter base, while `at` + `-est` is a two-letter stem and refused — which
 * is what keeps `attest` and `arrest` out of the derivation.
 *
 * A fifth candidate, *the stem with a `y` appended*, was measured and dropped:
 * it was the first match for 152 words and produced the wrong Rhyme Key for
 * **all 152** of them. The `y` spells an `IY0` that the derived word's own
 * spelling does not contain, so the composition keeps a vowel the word does not
 * have — `astronomer` ← `astronomy` gives `... M IY0 ER0` where the word is
 * `... M ER0`, and `bidder` ← `biddy` gives `B IH1 D IY0 ER0` for `B IH1 D ER0`.
 * The candidate is only ever right for suffixes that *replace* the `y`, and every
 * one of those (`-ist`, `-ity`) also moves the stem's stress and so is not
 * configured here. Issue #77 lists it; the measurement retires it.
 */
function stemSpellings(base: string, suffixStart: Phoneme): string[] {
  const candidates = isVowel(suffixStart) ? [base + "e", base] : [base];

  if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) candidates.push(base.slice(0, -1));
  if (base.endsWith("i")) candidates.push(base.slice(0, -1) + "y");

  return [...new Set(candidates)].filter((stem) => stem.length >= MIN_STEM_LENGTH);
}

/**
 * Where a reading puts its stress: the positions of its primary- and
 * secondary-stressed vowels, counted in vowels from the end of the word.
 */
function stressShape(reading: Pronunciation): string {
  const vowels = reading.filter(isVowel);
  return vowels
    .map((phoneme, i) => (isStressed(phoneme) ? String(vowels.length - i) : ""))
    .filter((mark) => mark !== "")
    .join(",");
}

function isStressed(phoneme: Phoneme): boolean {
  const stress = stressOf(phoneme);
  return stress === 1 || stress === 2;
}

/**
 * Whether a stem's readings agree about *where the stress falls* — the gate a
 * suffix has to pass and a prefix does not.
 *
 * A spelling with two readings is sometimes one word said two ways (`arid` is
 * `AE1 R AH0 D` or `EH1 R AH0 D`, `anxious` is `AE1 NG K SH AH S` or
 * `AE1 NG SH AH S`) and sometimes two different words. When the readings disagree
 * on stress placement, it is the second: `articulate` is a verb ending
 * `... L EY2 T` and an adjective ending `... L AH0 T`, and that contrast — a full
 * stressed vowel against an unstressed schwa — is the one ADR-0001 is built on and
 * the guardrail table protects.
 *
 * `-ly` and `-ness` attach to only one of those two words, and nothing in a
 * pronunciation says which, so composing on both asserts a rhyme the derived word
 * does not have. Measured against the pinned data, keeping both put
 * `articulately`, `desolately`, `adequateness` and eleven more into the
 * `lately`/`greatly`/`stately` family — a Puzzle a curator would ship. The stem
 * is refused instead, so those words stay unreachable rather than wrong; a missing
 * reading is the state they were already in, and ADR-0009's rule is fairness, not
 * completeness. The `-ed` variants go the same way (`aged` reads `EY1 JH D` and
 * `EY1 JH IH0 D`, so `agedly` waits for #78 to condition the `-ed` properly).
 */
function agreeOnStress(readings: readonly Pronunciation[]): boolean {
  return new Set(readings.map(stressShape)).size <= 1;
}

/**
 * Turn one configured suffix into a rule. The composition is refused unless the
 * derived Rhyme Key is the stem's key *extended* — the enforcement of the
 * stress-neutrality claim the inventory rests on. A suffix carrying a stressed
 * vowel would make its own vowel the last stressed one, and the key would stop
 * running from the stem; the rule refuses rather than storing that reading.
 */
function suffixRule({ spelling, phonemes }: Suffix): AffixRule {
  return {
    name: `suffix:${spelling}`,
    admits: agreeOnStress,
    stemsOf(word) {
      if (!word.endsWith(spelling)) return [];
      const base = word.slice(0, -spelling.length);
      const start = phonemes[0];
      if (start === undefined) return [];
      // A candidate equal to the word itself would derive the word from itself:
      // `curl` + `y` is `curly`, and `-ly`'s own base + `y` always is.
      return stemSpellings(base, start).filter((stem) => stem !== word);
    },
    read(stemReading) {
      const stemKey = rhymeKeyOf(stemReading);
      if (stemKey === null) return null;
      const composed = suffixed(stemReading, phonemes);
      const key = rhymeKeyOf(composed);
      if (key === null) return null;
      return key === stemKey || key.startsWith(`${stemKey} `) ? composed : null;
    },
  };
}

/**
 * Every affix rule, in the order the derivation stage tries them. Longest
 * spelling first, so the most specific segmentation of a word wins: `underpay`
 * is `under` + `pay`, not `un` + `derpay`, and `unhappiness` is `unhappy` +
 * `-ness` rather than `un` + `happiness`. Length ties break on the rule name,
 * which is unique, so the order is total and a rebuild cannot reshuffle it.
 */
export const AFFIX_RULES: readonly AffixRule[] = [
  ...PREFIXES.map((prefix) => ({ spelling: prefix.spelling, rule: prefixRule(prefix) })),
  ...SUFFIXES.map((suffix) => ({ spelling: suffix.spelling, rule: suffixRule(suffix) })),
]
  .sort(
    (a, b) =>
      b.spelling.length - a.spelling.length || a.rule.name.localeCompare(b.rule.name),
  )
  .map((entry) => entry.rule);
