/**
 * Reduce a surface form to its lemma for the knownness lookup only.
 *
 * The prevalence data (ADR-0003) lists ~62k lemmas, not inflected forms: it has
 * `gate`, not `gates`. Without lemmatising before that lookup, every inflected
 * form of every common word would be misfiled as an obscure Bonus Word. This
 * must NOT be applied before rhyme matching — `gate` and `gates` have different
 * Rhyme Keys, and only the surface form is the rhyme the player intended.
 *
 * Rule-based and deliberately conservative. It returns an ordered list of
 * candidate lemmas (most-specific first); the caller takes the first that the
 * prevalence data knows. A richer morphological lemmatiser can replace this
 * without changing the contract.
 *
 * A three-letter `-s` form is a candidate here but *not* on its spelling alone:
 * a caller that holds readings takes it through `lemmaCandidatesBySound`, which
 * keeps it only when the sound agrees. See that function for why.
 */

import { PREFIX_SPELLINGS } from "./affixes.ts";
import type { Pronunciation } from "./phonology.ts";

function dedupe(candidates: string[]): string[] {
  return [...new Set(candidates.filter((c) => c.length > 0))];
}

/**
 * The shortest `-s` form allowed a base. Two-letter forms are still refused:
 * that is where the word list's junk lives, and nothing in the Seed pool depends
 * on them.
 */
const SHORTEST_PLURAL = 3;

/** The phonemes a regular plural or third-person `-s` is realised as. */
const PLURAL_PHONEMES = new Set(["S", "Z"]);

export function lemmaCandidates(word: string): string[] {
  const w = word.trim().toLowerCase();
  const candidates = [w];

  // plural / third-person: -ies -> -y, -es, -s
  if (w.endsWith("ies") && w.length > 4) candidates.push(w.slice(0, -3) + "y");
  if (w.endsWith("es") && w.length > 3) candidates.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length >= SHORTEST_PLURAL) {
    candidates.push(w.slice(0, -1));
  }

  // past / progressive: -ied -> -y, -ed, -ing, with de-doubling and +e restore
  if (w.endsWith("ied") && w.length > 4) candidates.push(w.slice(0, -3) + "y");
  if (w.endsWith("ed") && w.length > 3) {
    candidates.push(w.slice(0, -2)); // walked -> walk
    candidates.push(w.slice(0, -1)); // waded -> wade
  }
  if (w.endsWith("ing") && w.length > 4) {
    candidates.push(w.slice(0, -3)); // walking -> walk
    candidates.push(w.slice(0, -3) + "e"); // rating -> rate
  }

  // de-double a final consonant (stopped -> stop, running -> run)
  for (const base of [...candidates]) {
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) {
      candidates.push(base.slice(0, -1));
    }
  }

  return dedupe(candidates);
}

/** A word's readings, as the index holds them. Empty if it has none. */
export type ReadingsOf = (word: string) => Pronunciation[];

/** True if a reading of `form` is exactly a reading of `base` plus S or Z. */
function soundsInflected(form: string, base: string, readingsOf: ReadingsOf): boolean {
  const baseReadings = readingsOf(base);
  if (baseReadings.length === 0) return false;
  for (const reading of readingsOf(form)) {
    if (!PLURAL_PHONEMES.has(reading[reading.length - 1] ?? "")) continue;
    const stem = reading.slice(0, -1);
    for (const baseReading of baseReadings) {
      if (baseReading.length !== stem.length) continue;
      if (baseReading.every((phoneme, i) => phoneme === stem[i])) return true;
    }
  }
  return false;
}

/**
 * `lemmaCandidates`, for a caller that holds readings: a three-letter `-s` form
 * keeps its base only when the *sound* agrees — the form's reading must be the
 * base's reading plus a final S or Z. Above three letters the list is returned
 * untouched, so the blast radius is bounded by construction.
 *
 * Spelling alone cannot do this job. Admitting every three-letter `-s` form
 * whose base holds wordhood reaches 142 words, against this rule's 24, and calls
 * `has` an inflection of `ha`, `yes` of `ye`, `gas` of `ga`. Neither can
 * knownness: `els` must be demoted, which needs `el` (prevalence −0.324) to
 * count as a base, while `has` must not be, which needs `ha` (1.280) not to — no
 * floor separates that pair, so the whole family of threshold rules is ruled out
 * by measurement rather than by taste. The vowel does what neither can: `ups` is
 * `AH1 P` + `S` and is an inflection of `up`; `has` is `HH AE1 Z` where `ha` is
 * `HH AA1`, and is an inflection of nothing.
 *
 * Refusing the whole class is what the bug was (#89's third cause, #97): `ups`
 * never yielded `up`, so `AH P S` scored as native rhyme content and stood as a
 * Seed — a board whose every Answer is a plural — while `ups`, `ads`, `ohs` and
 * `ons` took no knownness at all and were celebrated as Bonus Words.
 *
 * Known misses, documented rather than special-cased. `was` is `wa` + `Z` and
 * `yes` is `ye(2)` + `S` in the dictionary's own transcription, so both are read
 * as inflections. Measured cost: `AA Z` falls from 17 native members to 13 and
 * `EH S` from 84 to 80, neither leaves the Seed pool, neither is represented by
 * the demoted word, and both words keep their own knownness because they are in
 * the prevalence norms and the surface form is consulted first. An exception
 * list for two words that change no outcome would be pure cost.
 */
export function lemmaCandidatesBySound(word: string, readingsOf: ReadingsOf): string[] {
  const w = word.trim().toLowerCase();
  const candidates = lemmaCandidates(w);
  if (w.length > SHORTEST_PLURAL) return candidates;
  return candidates.filter((c) => c === w || soundsInflected(w, c, readingsOf));
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

/**
 * True if `word` is a regular inflection of some *other* dictionary word — the
 * inflectional bases the lemmatiser already yields, kept only when the
 * dictionary actually holds one. The word standing in for its own base (a word
 * that is its own only candidate) is not an inflection.
 */
function isInflection(
  word: string,
  isWord: (w: string) => boolean,
  readingsOf: ReadingsOf,
): boolean {
  return lemmaCandidatesBySound(word, readingsOf)
    .some((base) => base !== word && isWord(base));
}

/**
 * True if `word` is *derived* — a regular inflection (`-s/-es/-ies/-ed/-ing`) or
 * a common-prefix affixation (`un-/re-/out-/…`) of a dictionary word (ADR-0008).
 * A word that is neither is *native*: it carries rhyme content of its own, and
 * only native content makes a Rhyme Key eligible to be a Seed.
 *
 * Both passes are required. Suffix stripping alone lets `unaided`/`outstanding`
 * masquerade as native, so the shadow keys they sit in wrongly survive. A prefix
 * counts only when what remains is itself a real word or an inflection of one, so
 * a prefix that merely happens to start a native word — the `re` in `read` — is
 * not a false positive.
 *
 * `readingsOf` sits beside `isWord` because the shortest inflections cannot be
 * judged on spelling: see `lemmaCandidatesBySound`. Wordhood answers "is there a
 * base?", readings answer "does it sound like one?", and a word needs both.
 */
export function isDerived(
  word: string,
  isWord: (w: string) => boolean,
  readingsOf: ReadingsOf,
): boolean {
  const w = word.trim().toLowerCase();
  if (isInflection(w, isWord, readingsOf)) return true;
  for (const prefix of DERIVATIONAL_PREFIXES) {
    if (!w.startsWith(prefix)) continue;
    const base = w.slice(prefix.length);
    if (base.length < 2) continue;
    if (isWord(base) || isInflection(base, isWord, readingsOf)) return true;
  }
  return false;
}
