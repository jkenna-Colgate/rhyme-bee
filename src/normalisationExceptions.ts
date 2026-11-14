/**
 * **Normalisation Exceptions** (#323, ADR-0011 amended 2026-11-14): committed
 * lines that each take one reading Normalisation appended off one word.
 *
 * A reading can be right while the variant an appending rule makes from it is
 * wrong for that word: the rule goes a little too far there. The pronunciation
 * supplement cannot say so, because it is applied before Normalisation, so
 * whatever is written goes back through every rule and the variant comes back.
 * An exception is applied right after Normalisation instead: the word keeps the
 * reading the variant was made from and loses the variant. It is per word and
 * changes no rule, so reading manufacture stays frozen, and like a Demotion it
 * carries no date and no Rhyme Key: it holds on every day the word appears on.
 *
 * Only an appended reading can be excepted. Whether a reading was appended is
 * told the way the index tells it (`isGeneratedVariantOf` in
 * `src/rhymeIndex.ts`): by its shape against an earlier reading of the same
 * word. So a line can name exactly the readings the ruling list marks as
 * appended, and never a word's first reading, which is why a word cannot be
 * left with none. A line naming anything else is refused and reported, and the
 * build carries on without it. A line whose reading the word does not hold is
 * stale, and reported the way a stale Demotion is.
 *
 * The file is `data/normalisation-exceptions.txt`: `<word> <ARPAbet reading>`
 * a line, `#` comments. One module holds the parser and the serialiser, as
 * `src/demotions.ts` does, so the format has one spelling.
 */

import { normaliseWord } from "./cmudict.ts";
import { mergeWeakVowels } from "./normalise.ts";
import type { Pronunciation } from "./phonology.ts";
import { isGeneratedVariantOf } from "./rhymeIndex.ts";

/** One word and one exact reading Normalisation appended to it, as the index holds it. */
export interface NormalisationException {
  word: string;
  reading: Pronunciation;
}

/** Why a line was refused: the reading is the word's only one, or it is not one Normalisation appended. */
export type RefusalReason = "only-reading" | "not-appended";

/** The exceptions as applied, with every line that did nothing and why, for the build to name. */
export interface AppliedNormalisationExceptions {
  /** The lines that each took a reading off a word. */
  applied: NormalisationException[];
  /** The lines naming a reading that cannot be excepted. The index is built as if they were absent. */
  refused: (NormalisationException & { reason: RefusalReason })[];
  /** The lines whose word does not hold the reading, or holds none. */
  stale: NormalisationException[];
  /** The lines that do not read, as written. */
  malformed: string[];
}

/** The part of the index build's data this stage touches. Both are mutated. */
export interface NormalisationExceptionTarget {
  /** Surface form -> its readings, after Normalisation. */
  pronunciations: Map<string, Pronunciation[]>;
  /** Surface form -> the readings a Weak Rhyme is worked out from, where they differ (ADR-0020). */
  unmergedReadings?: Map<string, Pronunciation[]>;
}

const PHONEME = /^[A-Z]{1,2}[012]?$/;

/** One exception as a newline-terminated line, ready to append. */
export function serialiseNormalisationException(exception: NormalisationException): string {
  return `${normaliseWord(exception.word)} ${exception.reading.join(" ")}\n`;
}

/**
 * Parse the exceptions file: `<word> <ARPAbet reading>` a line, `#` comments
 * and blanks ignored. A line that does not read is returned in `malformed`
 * and skipped: a skipped line leaves a reading in play that the build then
 * names, where a throw would stop a build nobody is attending.
 */
export function parseNormalisationExceptions(text: string): { entries: NormalisationException[]; malformed: string[] } {
  const entries: NormalisationException[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const [word, ...reading] = line.split(/\s+/);
    if (reading.length === 0 || !reading.every((p) => PHONEME.test(p))) malformed.push(line);
    else entries.push({ word: normaliseWord(word!), reading });
  }
  return { entries, malformed };
}

const spelt = (reading: Pronunciation): string => reading.join(" ");

/**
 * Apply the exceptions over the readings Normalisation left, in place. Every
 * line is read against the word's readings as Normalisation left them, not as
 * an earlier line left them, so a reading appended to an appended reading can
 * be excepted together with the one it was made from.
 *
 * The reading a Weak Rhyme is worked out from goes too, where the word holds
 * its unmerged readings apart. Two tests find it, and either is enough. The two
 * lists come from the same rules in the same order, so when they are the same
 * length the reading in the same place is the same variant. And where the
 * weak-vowel merge made two readings one (`article`, written with either weak
 * vowel), the unmerged list is longer and holds a variant of each: those are
 * the readings the merge turns into the excepted one. Measured on the index of
 * 2026-11-14, 431 words holding an appended reading have lists of one length
 * and 94 do not (`.scratch/323/unmergedAligned.ts`).
 */
export function applyNormalisationExceptions(text: string, target: NormalisationExceptionTarget): AppliedNormalisationExceptions {
  const { entries, malformed } = parseNormalisationExceptions(text);
  const out: AppliedNormalisationExceptions = { applied: [], refused: [], stale: [], malformed };
  const going = new Map<string, Set<number>>();

  for (const entry of entries) {
    const readings = target.pronunciations.get(entry.word) ?? [];
    const at = readings.findIndex((r) => spelt(r) === spelt(entry.reading));
    if (at === -1 || going.get(entry.word)?.has(at)) out.stale.push(entry);
    else if (readings.length === 1) out.refused.push({ ...entry, reason: "only-reading" });
    else if (!readings.slice(0, at).some((earlier) => isGeneratedVariantOf(readings[at]!, earlier))) out.refused.push({ ...entry, reason: "not-appended" });
    else {
      going.set(entry.word, (going.get(entry.word) ?? new Set()).add(at));
      out.applied.push(entry);
    }
  }

  for (const [word, places] of going) {
    const readings = target.pronunciations.get(word)!;
    const unmerged = target.unmergedReadings?.get(word);
    target.pronunciations.set(word, readings.filter((_, i) => !places.has(i)));
    if (unmerged) {
      const aligned = unmerged.length === readings.length;
      const excepted = new Set([...places].map((i) => spelt(readings[i]!)));
      target.unmergedReadings!.set(word, unmerged.filter((u, i) => !(aligned && places.has(i)) && !excepted.has(spelt(mergeWeakVowels(u)))));
    }
  }
  return out;
}
