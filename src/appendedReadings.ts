/**
 * The Answers that only Normalisation puts on a day's Rhyme Key (#296; ADR-0021,
 * 2026-11-02 amendment). The No False Accepts hunt compares an Answer with its
 * Wiktionary readings, which go through the same Normalisation as the game's,
 * so a false accept a rule makes is confirmed by its own rule: `annual` was
 * never sent for `cool`. The fact that catches it is provenance: every reading
 * of the Answer on the key (or a key merged into it) is one Normalisation
 * appended, and none is one a source transcribed. The index marks each reading
 * so (`RhymeIndex.readingsOf`).
 *
 * This module is the selection alone. The trial that scores the Judge on those
 * Answers before the hunt depends on them (#297) is the maintainer's, run once,
 * and lives with its script (`scripts/judgeTrial.ts`).
 */

import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";

/** One reading as the index holds it, marked if Normalisation appended it. */
export interface MarkedReading {
  pronunciation: Pronunciation;
  generated: boolean;
}

/**
 * True when a word reaches one of `keys` (the Seed Word's Rhyme Key and the keys
 * merged into its family) through at least one reading, and every such reading
 * is one Normalisation appended.
 */
export function reachesKeyOnlyByAppended(readings: readonly MarkedReading[], keys: readonly RhymeKey[]): boolean {
  const on = readings.filter((r) => {
    const key = rhymeKeyOf(r.pronunciation);
    return key !== null && keys.includes(key);
  });
  return on.length > 0 && on.every((r) => r.generated);
}

/** A day's Answers that reach its keys only through appended readings, once each, in alphabetical order. */
export function appendedOnlyAnswers(
  answers: readonly string[],
  keys: readonly RhymeKey[],
  readingsOf: (word: string) => readonly MarkedReading[],
): string[] {
  return [...new Set(answers)].sort().filter((w) => reachesKeyOnlyByAppended(readingsOf(w), keys));
}
