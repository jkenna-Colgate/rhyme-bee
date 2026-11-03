/**
 * The trial of the Judge on Answers that only Normalisation puts on the Rhyme
 * Key (#296; ADR-0021, 2026-11-02 amendment), as pure functions: the sample the
 * maintainer rules on, the rulings given before it, and the score. The Answers
 * themselves are selected in `src/appendedReadings.ts`, which the hunt reads;
 * this is the maintainer's one-off trial and nothing in the game reads it.
 * `scripts/appendedReadingsTrial.ts` calls the model and writes the report.
 */

import type { Confidence, RhymeRuling } from "../src/judge.ts";
import { rulingList, type HuntRuling } from "../src/noFalseAccepts.ts";
import type { RhymeKey } from "../src/phonology.ts";

/** One scheduled day and the Answers on its key only through appended readings. */
export interface TrialDay {
  date: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  words: readonly string[];
}

/** One word put to the Judge for one Seed Word. */
export interface TrialPair {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  date: string;
}

/**
 * The sample the maintainer is asked about: one word from each of `n` days
 * spread evenly, in date order, across the days that have any, leaving out the
 * Seed Words in `ruled` (the days the maintainer's given rulings already
 * cover). From each day it takes the middle word of the day's alphabetical
 * list, so the same index always draws the same sample.
 */
export function sampleAcrossDays(days: readonly TrialDay[], n: number, ruled: ReadonlySet<string>): TrialPair[] {
  const eligible = days.filter((d) => d.words.length > 0 && !ruled.has(d.seedWord)).sort((a, b) => a.date.localeCompare(b.date));
  const take = Math.min(n, eligible.length);
  return Array.from({ length: take }, (_, i) => {
    const d = eligible[Math.floor(((i + 0.5) * eligible.length) / take)]!;
    const words = [...d.words].sort();
    return { word: words[Math.floor(words.length / 2)]!, seedWord: d.seedWord, rhymeKey: d.rhymeKey, date: d.date };
  });
}

/** The maintainer's ruling on a sampled pair, or a skip, which is scored with nothing. */
export type SampleRuling = "rhyme" | "no-rhyme" | "skip";

/**
 * What the maintainer is asked of a sampled pair, before seeing the Judge's
 * ruling: the question, that an answer is awaited, and one command a line with
 * its effect. Every command it names is one `parseSampleRuling` reads.
 */
export function samplePrompt(pair: TrialPair): string[] {
  return [
    `Does ${pair.word} rhyme with ${pair.seedWord} (/${pair.rhymeKey}/, ${pair.date}), in General American as you say it?`,
    "Waiting for your ruling. Type one of these and press Enter:",
    "  y      a Rhyme: the game is right to score it",
    "  n      no Rhyme: a false accept the hunt should catch",
    "  s      skip it: it is scored with nothing",
  ];
}

const SAMPLE_COMMANDS: ReadonlyMap<string, SampleRuling> = new Map([["y", "rhyme"], ["n", "no-rhyme"], ["s", "skip"]]);

/** A ruling as the maintainer types it. Null when it does not read, so the caller asks again. */
export function parseSampleRuling(input: string): SampleRuling | null {
  return SAMPLE_COMMANDS.get(input.trim().toLowerCase()) ?? null;
}

/** A ruling the maintainer gave before the trial. */
export interface GivenRuling {
  word: string;
  seedWord: string;
  maintainer: "rhyme" | "no-rhyme";
}

/**
 * The rulings the maintainer had already given on these words (#288, #296):
 * stress promotion's weak endings on `chess` and `event` are no Rhyme, and
 * `shoot`'s, `lawn`'s and `hire`'s words are Rhymes.
 */
export const GIVEN_RULINGS: readonly GivenRuling[] = [
  { word: "gutless", seedWord: "chess", maintainer: "no-rhyme" },
  { word: "flavorless", seedWord: "chess", maintainer: "no-rhyme" },
  { word: "thankfulness", seedWord: "chess", maintainer: "no-rhyme" },
  { word: "comment", seedWord: "event", maintainer: "no-rhyme" },
  { word: "document", seedWord: "event", maintainer: "no-rhyme" },
  { word: "tribute", seedWord: "shoot", maintainer: "rhyme" },
  { word: "neon", seedWord: "lawn", maintainer: "rhyme" },
  { word: "admire", seedWord: "hire", maintainer: "rhyme" },
];

/** One pair the Judge ruled on, beside the maintainer's ruling on it. */
export interface TrialItem {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  from: "given" | "sampled";
  maintainer: SampleRuling;
  judge: RhymeRuling;
}

/** Agreed, and compared. */
export type Agreement = [agreed: number, compared: number];

export interface TrialScore {
  /** The pairs the maintainer ruled on (a skip is not one). */
  compared: number;
  /** Those where the Judge's verdict was the maintainer's. A pair the Judge gave no ruling on disagrees. */
  agreed: number;
  /** `agreed / compared`, or null when nothing was compared. */
  rate: number | null;
  byFrom: Record<TrialItem["from"], Agreement>;
  /** At each confidence the Judge gave. */
  byConfidence: Record<Confidence, Agreement>;
  /** What the hunt would do: of the pairs the maintainer ruled no Rhyme, how many its ruling list holds. */
  falseAcceptsListed: Agreement;
  /** And of the pairs the maintainer ruled Rhymes, how many it would put on the list anyway, each one for the maintainer to leave. */
  rhymesListed: Agreement;
  misses: TrialItem[];
}

/** Whether the hunt's ruling list would hold the pair for its rhyme ruling alone (`rulingList`'s high-confidence no Rhyme). */
function listedAsNoRhyme(item: TrialItem): boolean {
  const ruling: HuntRuling = { seedWord: item.seedWord, rhymeKey: item.rhymeKey, answer: { word: item.word, reasons: [], wiktionaryKeys: [] }, rhyme: item.judge };
  return rulingList([ruling]).some((l) => l.doubts.includes("no-rhyme"));
}

/**
 * The Judge's rhyme rulings scored against the maintainer's, on every pair the
 * maintainer ruled. The verdict is compared as the Judge gave it: the hunt
 * reads only whether a ruling is a high-confidence no Rhyme, so whether a
 * Rhyme's reading reaches the key changes nothing it does.
 */
export function scoreTrial(items: readonly TrialItem[]): TrialScore {
  const out: TrialScore = {
    compared: 0, agreed: 0, rate: null,
    byFrom: { given: [0, 0], sampled: [0, 0] },
    byConfidence: { high: [0, 0], medium: [0, 0], low: [0, 0] },
    falseAcceptsListed: [0, 0], rhymesListed: [0, 0], misses: [],
  };
  const tally = (into: Agreement, yes: boolean) => { into[0] += yes ? 1 : 0; into[1]++; };
  for (const item of items) {
    if (item.maintainer === "skip") continue;
    const agrees = item.judge.verdict === item.maintainer;
    out.compared++;
    if (agrees) out.agreed++;
    else out.misses.push(item);
    tally(out.byFrom[item.from], agrees);
    tally(out.byConfidence[item.judge.confidence], agrees);
    tally(item.maintainer === "no-rhyme" ? out.falseAcceptsListed : out.rhymesListed, listedAsNoRhyme(item));
  }
  out.rate = out.compared ? out.agreed / out.compared : null;
  return out;
}
