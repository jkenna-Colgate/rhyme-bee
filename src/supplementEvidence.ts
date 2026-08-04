/**
 * The evidence a supplement judge needs for one word against one target Rhyme
 * Key (ADR-0009): wordhood, name status, any direct reading the word already
 * carries (the *correction* case), and — only when it has no direct reading —
 * its inflectional relatives' readings (the *derivation* case). Pulled out of
 * the queue-driven report so a maintainer's supplied word list gets identical
 * evidence, one word at a time, without a captured candidate to drive it (#70).
 *
 * This module answers "what is true of this word", nothing more: it decides no
 * add/correct/derive/defer call, matching the report's own rule.
 */

import { normaliseWord } from "./cmudict.ts";
import type { Derivation } from "./derivation.ts";
import { inflectionalVariants } from "./inflections.ts";
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
  /** This word's own CMUdict readings — the correction case, when non-empty. */
  direct: ReadingEvidence[];
  /** True if any direct reading's Rhyme Key already equals the target. */
  rhymesDirectly: boolean;
  /**
   * Inflectional relatives CMUdict holds — the derivation case. Only searched
   * when `direct` is empty: a word with its own reading is a correction, never
   * a derivation, so relatives are not offered as a distraction from it.
   */
  relatives: RelativeEvidence[];
}

/** The pinned inputs `gatherEvidence` reads against — one Rhyme Index's worth. */
export interface EvidenceContext {
  pronunciations: ReadonlyMap<string, Pronunciation[]>;
  words: ReadonlySet<string>;
  names: ReadonlySet<string>;
  derivation: Derivation;
}

function readingsOf(word: string, pronunciations: ReadonlyMap<string, Pronunciation[]>): ReadingEvidence[] {
  const prons = pronunciations.get(word) ?? [];
  return prons.map((phonemes) => ({ phonemes, key: rhymeKeyOf(phonemes) }));
}

function rhymesOnTarget(readings: ReadingEvidence[], target: RhymeKey): boolean {
  return readings.some((r) => r.key === target);
}

/** Gather the correction/derivation evidence for `word` against `target`. */
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
  };
}
