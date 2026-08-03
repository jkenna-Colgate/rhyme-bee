/**
 * Fixture data back out to the pinned text formats.
 *
 * A fixture holds its slice as maps and sets, because that is how it stays
 * legible and commentable. The index build, though, parses its own inputs — a
 * caller that parsed first would be back to holding the stages in the right
 * order itself (#100) — and it is that one call a test index has to go through
 * (#106). These turn the one into the other, so no fixture has to keep a second
 * copy of its data in a format nobody can read.
 */

import type { Pronunciation } from "../phonology.ts";

/** Readings to CMUdict text: `WORD  P1 P2`, alternates as `WORD(n)`. */
export function toCmudictText(readings: Map<string, Pronunciation[]>): string {
  const lines: string[] = [];
  for (const [word, prons] of readings) {
    prons.forEach((pron, i) => {
      lines.push(`${word.toUpperCase()}${i === 0 ? "" : `(${i})`}  ${pron.join(" ")}`);
    });
  }
  return lines.join("\n");
}

/** Knownness to the norms' CSV, headers and all (ADR-0003). */
export function toPrevalenceCsv(scores: Map<string, number>): string {
  const rows = [...scores].map(([word, score]) => `${word},${score}`);
  return ["Word,Prevalence", ...rows].join("\n");
}

/** Wordhood and name lists to text: one per line, as `data/` carries them. */
export function toWordListText(entries: Iterable<string>): string {
  return [...entries].join("\n");
}
