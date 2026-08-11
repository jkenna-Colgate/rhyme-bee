/**
 * The evidence a supplement judge needs for one word against one target Rhyme
 * Key (ADR-0009): wordhood, name status, any direct reading the word already
 * carries (the *pronunciation correction* case), and — only when it has no
 * direct reading — its inflectional relatives' readings (the *derivation*
 * case). Pulled out of the queue-driven report so a maintainer's supplied word
 * list gets identical evidence, one word at a time, without a captured
 * candidate to drive it (#70).
 *
 * This module answers "what is true of this word", nothing more: it decides no
 * add/correct/derive/defer call, matching the report's own rule.
 */

import { normaliseWord } from "./cmudict.ts";
import { Derivation, IndexDataSource } from "./derivation.ts";
import { inflectionalVariants } from "./inflections.ts";
import { applyNormalisation } from "./normalise.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";

/** One reading, alongside the Rhyme Key it yields (null if unstressed). */
export interface ReadingEvidence {
  phonemes: Pronunciation;
  key: RhymeKey | null;
}

/** An inflectional relative's readings, and whether any rhymes on the target. */
export interface RelativeEvidence {
  word: string;
  readings: ReadingEvidence[];
  rhymes: boolean;
}

/** Everything gathered for one supplied word against one target Rhyme Key. */
export interface WordEvidence {
  word: string;
  target: RhymeKey;
  isWord: boolean;
  isName: boolean;
  /** Its own CMUdict readings — the pronunciation-correction case, when non-empty. */
  direct: ReadingEvidence[];
  /** True if any direct reading's Rhyme Key already equals the target. */
  rhymesDirectly: boolean;
  /**
   * Inflectional relatives CMUdict holds — the derivation case. Only searched
   * when `direct` is empty: a word with its own reading is a pronunciation
   * correction, never a derivation, so relatives are not offered as a
   * distraction from it.
   */
  relatives: RelativeEvidence[];
  /**
   * A reading composed from a compound split, when one reaches the target.
   * Null when no split does, and — like `relatives` — never searched for a word
   * that already has a direct reading, which is a pronunciation correction
   * rather than an add.
   */
  composed: ComposedReading | null;
}

/**
 * A word and one reading of it — the pair `data/supplement.dict` records a line
 * at a time. It names a part of a compound split below, and it names an
 * accepted add wherever one is being carried to that file.
 */
export interface WordReading {
  word: string;
  phonemes: Pronunciation;
}

/**
 * A reading composed for a word the editor named, with the parts it came from
 * so the proposal is inspectable rather than opaque. Its `key` equals the
 * target by construction — nothing that fails `verifyReading` is ever returned.
 */
export interface ComposedReading {
  phonemes: Pronunciation;
  key: RhymeKey;
  head: WordReading;
  tail: WordReading;
}

/** The pinned inputs `gatherEvidence` reads against — one Rhyme Index's worth. */
export interface EvidenceContext {
  pronunciations: ReadonlyMap<string, Pronunciation[]>;
  words: ReadonlySet<string>;
  names: ReadonlySet<string>;
  derivation: Derivation;
}

/** The pinned inputs a context is assembled from, before Normalisation. */
export interface EvidenceInputs {
  pronunciations: Map<string, Pronunciation[]>;
  words: Set<string>;
  names: Set<string>;
}

/**
 * Assemble a context from inputs read straight off `data/`, applying
 * Normalisation exactly as the index build applies it (`src/manufacture.ts`,
 * step 4) — so evidence gathered here and a Rhyme Key taken from the built
 * artifact are computed under one phonology rather than two.
 *
 * That divergence is not a rounding difference. `cot-caught-merger` *replaces*
 * a reading, so a raw `AO` computes a Rhyme Key a merged target can never
 * equal; `syllabic-consonant` and `stress-promotion` *append*, so raw inputs
 * are simply missing readings the Index holds. Either way the evidence is short
 * of what the game will read.
 *
 * It widens what is *seen*, never what is *accepted*: `verifyReading` below is
 * unchanged and stays exact equality against the target (ADR-0014). Every
 * divergence it closes was a false negative, and a false negative here is a
 * word recorded in the deferred queue as a composition failure it never was.
 *
 * `pronunciations` is rewritten in place, as the build's own stage does — the
 * caller hands its inputs over rather than keeping the raw readings alongside.
 */
export function evidenceContextFrom(inputs: EvidenceInputs): EvidenceContext {
  const { pronunciations, words, names } = inputs;
  applyNormalisation({ pronunciations });
  // Built last, so the derivation reads the normalised map and nothing
  // downstream can reach the readings Normalisation replaced.
  const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));
  return { pronunciations, words, names, derivation };
}

function readingsOf(word: string, pronunciations: ReadonlyMap<string, Pronunciation[]>): ReadingEvidence[] {
  const prons = pronunciations.get(word) ?? [];
  return prons.map((phonemes) => ({ phonemes, key: rhymeKeyOf(phonemes) }));
}

function rhymesOnTarget(readings: ReadingEvidence[], target: RhymeKey): boolean {
  return readings.some((r) => r.key === target);
}

/**
 * The one accept-or-reject test for a proposed reading: it is accepted only
 * when its computed Rhyme Key equals the Rhyme Key it is being added to.
 *
 * **Author-blind, and the single such predicate** (ADR-0014). The composition
 * below goes through it, an agent asked to author an awkward word goes through
 * it, and so does a human — which is what makes it a stronger guarantee than
 * hand-authoring, where nothing checks the author at all.
 *
 * Its known limit is accepted rather than mitigated: a Rhyme Key runs from the
 * last stressed vowel, so this constrains the tail of a reading and can say
 * nothing about its head. A wrong head cannot change a verdict — adjudication
 * compares only Rhyme Keys — but it would be audible if the word were later
 * drawn as a Seed Word, which is spoken (ADR-0002).
 */
export function verifyReading(phonemes: Pronunciation, target: RhymeKey): boolean {
  return rhymeKeyOf(phonemes) === target;
}

/** Every primary stress in a reading demoted to secondary. */
function demote(phonemes: Pronunciation): Pronunciation {
  return phonemes.map((phoneme) => phoneme.replace(/1$/, "2"));
}

/**
 * Compose a reading for a word the pinned sources do not read, from a compound
 * split: a head and a tail that are themselves words with readings, the tail
 * taking secondary stress.
 *
 * This encodes the rule the existing supplement entries were authored under by
 * hand — `airburst` is recorded there as "air (EH1 R) + burst (B ER1 S T), the
 * compound taking secondary". The machine's `placeholder` is identical to the
 * hand derivation.
 *
 * Every split is tried, and every reading of both parts, because the accept
 * test is exact equality against the target: a wider search cannot admit a
 * wrong reading, only stop losing a good one to a part whose first reading
 * happened to be the wrong one. Returns null when no split reaches the target,
 * which is a word for the deferred queue rather than a failure.
 *
 * This is not reading manufacture (ADR-0014): it produces one verified reading
 * for one word the editor named, never a rule that reaches words nobody asked
 * about.
 */
export function composeReading(
  word: string,
  target: RhymeKey,
  ctx: EvidenceContext,
): ComposedReading | null {
  const w = normaliseWord(word);
  for (let i = 1; i < w.length; i++) {
    const headWord = w.slice(0, i);
    const tailWord = w.slice(i);
    for (const head of ctx.pronunciations.get(headWord) ?? []) {
      for (const tail of ctx.pronunciations.get(tailWord) ?? []) {
        const phonemes = [...head, ...demote(tail)];
        if (!verifyReading(phonemes, target)) continue;
        return {
          phonemes,
          key: target,
          head: { word: headWord, phonemes: head },
          tail: { word: tailWord, phonemes: tail },
        };
      }
    }
  }
  return null;
}

/** Gather the pronunciation-correction/derivation evidence for `word` against `target`. */
export function gatherEvidence(word: string, target: RhymeKey, ctx: EvidenceContext): WordEvidence {
  const w = normaliseWord(word);
  const direct = readingsOf(w, ctx.pronunciations);

  const relatives: RelativeEvidence[] = direct.length > 0
    ? []
    : inflectionalVariants(w, ctx.derivation)
        .filter((v) => ctx.pronunciations.has(v))
        .map((v) => {
          const readings = readingsOf(v, ctx.pronunciations);
          return { word: v, readings, rhymes: rhymesOnTarget(readings, target) };
        });

  return {
    word: w,
    target,
    isWord: ctx.words.has(w),
    isName: ctx.names.has(w),
    direct,
    rhymesDirectly: rhymesOnTarget(direct, target),
    relatives,
    // Scoped to a word with no direct reading, like the relatives above and for
    // the same reason: a word that already reads, wrongly, is a *pronunciation
    // correction*, and overriding an upstream pronunciation by machine is a
    // bigger claim than filling a gap. That stays the deliberate hand-edit it
    // is today.
    composed: direct.length > 0 ? null : composeReading(w, target, ctx),
  };
}
