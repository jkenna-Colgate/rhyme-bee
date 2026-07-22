/**
 * CMUdict ingestion (BSD-2-Clause). Parses the pinned dictionary text into a
 * map from surface form to its set of pronunciations. The raw file is not
 * committed (see .gitignore / ADR-0003); the build step reads a pinned copy,
 * and tests read a small fixture with the same format.
 *
 * Line format: `WORD  P1 P2 P3`, two spaces before the phonemes. Alternate
 * pronunciations are `WORD(1)`, `WORD(2)`, .... Comment lines start with `;;;`.
 */

import type { Pronunciation } from "./phonology.ts";

const VARIANT_SUFFIX = /\(\d+\)$/;

/** Normalise a surface form for lookup: lower-cased, whitespace-trimmed. */
export function normaliseWord(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * Parse CMUdict text into `surface form -> pronunciations`. Surface forms are
 * lower-cased; a word's alternate-pronunciation entries are merged into one set.
 */
export function parseCmudict(text: string): Map<string, Pronunciation[]> {
  const dict = new Map<string, Pronunciation[]>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(";;;")) continue;

    const separator = line.indexOf("  ");
    if (separator === -1) continue;

    const head = line.slice(0, separator).replace(VARIANT_SUFFIX, "");
    const phonemes = line
      .slice(separator + 2)
      .trim()
      .split(/\s+/)
      .filter((p) => p !== "");
    if (phonemes.length === 0) continue;

    const word = normaliseWord(head);
    const existing = dict.get(word);
    if (existing) existing.push(phonemes);
    else dict.set(word, [phonemes]);
  }
  return dict;
}
