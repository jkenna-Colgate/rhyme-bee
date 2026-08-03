/**
 * Derivation: is this word a derived form, and what lemmas could it reduce to?
 *
 * Both questions need two lookups — wordhood ("is there a base?") and readings
 * ("does it sound like one?") — and they must come from the *same* Rhyme Index
 * or the answers are incoherent. Previously every caller built the two as loose
 * closures and passed them as separate parameters, so nothing forced the pair to
 * agree; this module makes that pairing the only shape available. A caller gets
 * a `Derivation` from the index and calls methods on it (ADR-0008).
 *
 * The rules themselves are unchanged — this changes who holds the lookups, not
 * what counts as derived.
 */

import { PREFIX_SPELLINGS } from "./affixes.ts";
import { normaliseWord } from "./cmudict.ts";
import { lemmaCandidates } from "./lemmatise.ts";
import type { Pronunciation } from "./phonology.ts";

/**
 * The one thing a derivation question is asked against. Implemented by the
 * Rhyme Index's own adapter and by test doubles — never assembled from two
 * independent functions at a call site, which is the mismatch this interface
 * exists to make unrepresentable.
 */
export interface DerivationSource {
  /** True if the surface form is in the wordhood word list (names excluded). */
  hasWord(word: string): boolean;
  /** The readings of a surface form, empty if it has none. */
  readingsOf(word: string): Pronunciation[];
}

/**
 * The lookups an index's data answers with. Both come off *one* object, which is
 * the whole point: a word list paired with somebody else's readings cannot be
 * expressed. Used by the Rhyme Index itself and by the offline scripts that hold
 * the same pinned inputs before an index exists.
 */
export class IndexDataSource implements DerivationSource {
  readonly #words: ReadonlySet<string>;
  readonly #pronunciations: ReadonlyMap<string, Pronunciation[]>;

  constructor(data: {
    words: ReadonlySet<string>;
    pronunciations: ReadonlyMap<string, Pronunciation[]>;
  }) {
    this.#words = data.words;
    this.#pronunciations = data.pronunciations;
  }

  hasWord(word: string): boolean {
    return this.#words.has(normaliseWord(word));
  }

  readingsOf(word: string): Pronunciation[] {
    return this.#pronunciations.get(normaliseWord(word)) ?? [];
  }
}

/** The phonemes a regular plural or third-person `-s` is realised as. */
const S_SUFFIX_PHONEMES = new Set(["S", "Z"]);

/**
 * The base of a three-letter `-s` form — `up` for `ups` — or null if the word is
 * not one. Two-letter forms have none: that is where the word list's junk lives,
 * and nothing in the Seed pool depends on them.
 */
function shortSFormBase(w: string): string | null {
  if (w.length !== 3) return null;
  if (!w.endsWith("s") || w.endsWith("ss")) return null;
  return w.slice(0, -1);
}

/**
 * Common derivational prefixes (ADR-0008), read from the one affix inventory
 * the build configures — the same list the coverage stage composes readings
 * with. They must not drift apart: a prefix that can give a word a reading puts
 * that word in a Rhyme Key family, and a detector that did not know the prefix
 * would score it as native content and let a Shadow Key stand as a Seed.
 *
 * The minimum stem length is deliberately *not* shared. Inventing a reading for
 * a two-letter stem is a bad bet, so `src/affixes.ts` refuses it; merely
 * recognising `redo` as `re` + `do` is safe and stays here.
 */
const DERIVATIONAL_PREFIXES = PREFIX_SPELLINGS;

export class Derivation {
  readonly #source: DerivationSource;

  constructor(source: DerivationSource) {
    this.#source = source;
  }

  /**
   * `lemmaCandidates`, with the readings this instance holds: a three-letter
   * `-s` form gains its base when the *sound* agrees — the form's reading must
   * be the base's reading plus a final S or Z. It adds a candidate and removes
   * none, and the only word it can add one to is a three-letter `-s` form, so
   * the blast radius is bounded by construction.
   *
   * Spelling alone cannot do this job. Admitting every three-letter `-s` form
   * whose base holds wordhood reaches 142 words, against this rule's 24, and
   * calls `has` an inflection of `ha`, `yes` of `ye`, `gas` of `ga`. Neither can
   * knownness: `els` must be demoted, which needs `el` (prevalence −0.324) to
   * count as a base, while `has` must not be, which needs `ha` (1.280) not to —
   * no floor separates that pair, so the whole family of threshold rules is
   * ruled out by measurement rather than by taste. The vowel does what neither
   * can: `ups` is `AH1 P` + `S` and is an inflection of `up`; `has` is
   * `HH AE1 Z` where `ha` is `HH AA1`, and is an inflection of nothing.
   *
   * Refusing the whole class is what the bug was (#89's third cause, #97): `ups`
   * never yielded `up`, so `AH P S` scored as native rhyme content and stood as
   * a Seed — a board whose every Answer is a plural — while `ups`, `ads`, `ohs`
   * and `ons` took no knownness at all and were celebrated as Bonus Words.
   *
   * Known misses, documented rather than special-cased. `was` is `wa` + `Z` and
   * `yes` is `ye(2)` + `S` in the dictionary's own transcription, so both are
   * read as inflections. Measured cost: `AA Z` falls from 17 native members to
   * 13 and `EH S` from 82 to 78, neither leaves the Seed pool, neither is
   * represented by the demoted word, and both words keep their own knownness
   * because they are in the prevalence norms and the surface form is consulted
   * first. An exception list for two words that change no outcome would be pure
   * cost.
   */
  lemmaCandidates(word: string): string[] {
    const w = word.trim().toLowerCase();
    const candidates = lemmaCandidates(w);
    const base = shortSFormBase(w);
    if (base === null || !this.#soundsInflected(w, base)) return candidates;
    // Last, because the surface form is still consulted first: `was` is in the
    // prevalence norms and keeps its own knownness, whatever `wa` scores.
    return [...new Set([...candidates, base])];
  }

  /**
   * True if `word` is *derived* — a regular inflection (`-s/-es/-ies/-ed/-ing`)
   * or a common-prefix affixation (`un-/re-/out-/…`) of a dictionary word
   * (ADR-0008). A word that is neither is *native*: it carries rhyme content of
   * its own, and only native content makes a Rhyme Key eligible to be a Seed.
   *
   * Both passes are required. Suffix stripping alone lets
   * `unaided`/`outstanding` masquerade as native, so the shadow keys they sit in
   * wrongly survive. A prefix counts only when what remains is itself a real
   * word or an inflection of one, so a prefix that merely happens to start a
   * native word — the `re` in `read` — is not a false positive.
   */
  isDerived(word: string): boolean {
    const w = word.trim().toLowerCase();
    if (this.#isInflection(w)) return true;
    for (const prefix of DERIVATIONAL_PREFIXES) {
      if (!w.startsWith(prefix)) continue;
      const base = w.slice(prefix.length);
      if (base.length < 2) continue;
      if (this.#source.hasWord(base) || this.#isInflection(base)) return true;
    }
    return false;
  }

  /**
   * True if `word` is a regular inflection of some *other* dictionary word — the
   * inflectional bases the lemmatiser already yields, kept only when the
   * dictionary actually holds one. The word standing in for its own base (a word
   * that is its own only candidate) is not an inflection.
   */
  #isInflection(word: string): boolean {
    return this.lemmaCandidates(word)
      .some((base) => base !== word && this.#source.hasWord(base));
  }

  /** True if a reading of `form` is exactly a reading of `base` plus S or Z. */
  #soundsInflected(form: string, base: string): boolean {
    const baseReadings = this.#source.readingsOf(base);
    if (baseReadings.length === 0) return false;
    for (const reading of this.#source.readingsOf(form)) {
      if (!S_SUFFIX_PHONEMES.has(reading[reading.length - 1] ?? "")) continue;
      const stem = reading.slice(0, -1);
      for (const baseReading of baseReadings) {
        if (baseReading.length !== stem.length) continue;
        if (baseReading.every((phoneme, i) => phoneme === stem[i])) return true;
      }
    }
    return false;
  }
}
