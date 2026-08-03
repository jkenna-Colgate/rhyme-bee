/**
 * Builds a fixture's slice the way the game builds its index.
 *
 * A fixture holds its slice as maps and sets, because that is how it stays
 * legible and commentable. The index build takes text and parses it itself — a
 * caller that parsed first would be back to holding the stages in the right
 * order (#100) — so a fixture that wants the build's verdicts has to hand over
 * text. This turns the one into the other, so no fixture keeps a second copy of
 * its data in a format nobody can read, and every test index runs all four
 * stages in the committed order (#106).
 *
 * Only `buildSlice` leaves here. The text formats are this module's business.
 */

import { manufactureIndexData, type PinnedInputs } from "../manufacture.ts";
import type { Pronunciation } from "../phonology.ts";
import { RhymeIndex, type RhymeIndexData } from "../rhymeIndex.ts";

/** What a fixture holds, before any of it has been turned back into text. */
export interface FixtureSlice {
  pronunciations: Map<string, Pronunciation[]>;
  words: Iterable<string>;
  names?: Iterable<string>;
  prevalence?: Map<string, number>;
  demotions?: string;
  supplement?: string;
}

/** Readings to CMUdict text: `WORD  P1 P2`, alternates as `WORD(n)`. */
function toCmudictText(readings: Map<string, Pronunciation[]>): string {
  const lines: string[] = [];
  for (const [word, prons] of readings) {
    prons.forEach((pron, i) => {
      lines.push(`${word.toUpperCase()}${i === 0 ? "" : `(${i})`}  ${pron.join(" ")}`);
    });
  }
  return lines.join("\n");
}

/** Knownness to the norms' CSV, headers and all (ADR-0003). */
function toPrevalenceCsv(scores: Map<string, number>): string {
  const rows = [...scores].map(([word, score]) => `${word},${score}`);
  return ["Word,Prevalence", ...rows].join("\n");
}

/** Wordhood and name lists to text: one per line, as `data/` carries them. */
function toWordListText(entries: Iterable<string>): string {
  return [...entries].join("\n");
}

/**
 * A slice as the pinned files would carry it. What a slice leaves out is empty
 * text, which every stage takes as a legitimate no-op — the point is not that a
 * stage has something to do, it is that the stage runs.
 */
function toPinnedInputs(slice: FixtureSlice): PinnedInputs {
  return {
    cmudict: toCmudictText(slice.pronunciations),
    words: toWordListText(slice.words),
    names: toWordListText(slice.names ?? []),
    prevalence: toPrevalenceCsv(slice.prevalence ?? new Map()),
    demotions: slice.demotions ?? "",
    supplement: slice.supplement ?? "",
  };
}

/**
 * A slice built by the call `npm run build:index` makes: demotions, supplement,
 * coverage, normalisation, in that order. The finished data comes back too,
 * because it is what the build would have serialised.
 */
export function buildSlice(
  slice: FixtureSlice,
  knownnessThreshold: number,
): { index: RhymeIndex; data: RhymeIndexData } {
  const { data } = manufactureIndexData(toPinnedInputs(slice));
  return { index: new RhymeIndex(data, { knownnessThreshold }), data };
}
