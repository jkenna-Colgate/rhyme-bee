/**
 * The Seed Word test (#264): what a word must be to hold a place in the
 * Schedule, decided across #238, #252 and #259 and held in GLOSSARY.md's Seed
 * Word entry. A word can be a Seed Word on a Rhyme Key only if
 *
 *  1. it is **heard one way**: none of its other readings rhymes with a word
 *     its pinned reading does not (ADR-0012, amended 2026-10-14), so a player
 *     who knows the other reading is not turned away for hunting on it;
 *  2. it is **an Answer**: a word almost nobody knows cannot establish the
 *     sound a day is played on;
 *  3. it is **not an Unconfirmed Rhyme** on any Rhyme Key, so nothing swaps a
 *     Seed Word on the Judge's word alone.
 *
 * It is a gate on a word joining the Schedule, run once over every place and
 * then on each Seed Word that joins, and not at every build: the readings it
 * reads change only when a Normalisation or a hand-written reading lands.
 * Pinning is a separate question (`RhymeIndex#pinSeed`) and the Continuity
 * check asks it at every build.
 */

import { normaliseWord } from "./cmudict.ts";
import { rankSeedWords } from "./curation.ts";
import type { RhymeKey } from "./phonology.ts";
import { matchingPronunciation, type RhymeIndex } from "./rhymeIndex.ts";
import type { ScheduleDay } from "./schedule.ts";
import { schwaTwinOf } from "./schwaTwins.ts";

/** The words one other reading rhymes with that the pinned reading does not. */
export interface StrayRhymes {
  rhymeKey: RhymeKey;
  words: string[];
}

export type SeedWordTest =
  | { passes: true }
  | { passes: false; reason: "not-heard-one-way"; strays: StrayRhymes[] }
  | { passes: false; reason: "not-an-answer"; knownness: number | null }
  | { passes: false; reason: "unconfirmed-rhyme" };

/** Run the test on `word` pinned to `rhymeKey`, reporting the first part it fails. */
export function testSeedWord(index: RhymeIndex, word: string, rhymeKey: RhymeKey): SeedWordTest {
  const strays = strayRhymes(index, word, rhymeKey);
  if (strays.length > 0) return { passes: false, reason: "not-heard-one-way", strays };
  const { tier, knownness } = index.tierOf(word);
  if (tier !== "answer") return { passes: false, reason: "not-an-answer", knownness };
  if (index.isUnconfirmedRhyme(word)) return { passes: false, reason: "unconfirmed-rhyme" };
  return { passes: true };
}

/**
 * The family's Seed Word: its best-ranked word (`chooseRepresentative`'s
 * order) that passes the test, or null when none does. A day whose Seed Word
 * fails goes here, keeping its Rhyme Key.
 */
export function seedWordFor(words: string[], index: RhymeIndex, rhymeKey: RhymeKey): string | null {
  return rankSeedWords(words, index, rhymeKey).find((w) => testSeedWord(index, w, rhymeKey).passes) ?? null;
}

/**
 * Every other reading's rhymes the pinned one misses. Where a reading came from
 * does not matter (a Normalisation's appended reading counts like the
 * dictionary's), and a reading on the pinned key's Schwa Twin holds the same
 * words, so it takes nothing away: `fiction` passes.
 */
function strayRhymes(index: RhymeIndex, word: string, rhymeKey: RhymeKey): StrayRhymes[] {
  const strays: StrayRhymes[] = [];
  const asked = new Set<RhymeKey>([rhymeKey]);
  for (const other of index.rhymeKeysOf(word)) {
    // A Schwa Twin of a key already asked holds the same family, and saying
    // so twice would read as two readings where the player hears one.
    const twin = schwaTwinOf(other);
    if (asked.has(other) || (twin !== null && asked.has(twin))) continue;
    asked.add(other);
    const words = index
      .familyOf(other)
      .members.filter((m) => m.word !== word)
      .filter((m) => matchingPronunciation(rhymeKey, index.readingsOf(m.word).map((r) => r.pronunciation)) === null)
      .map((m) => m.word);
    if (words.length > 0) strays.push({ rhymeKey: other, words });
  }
  return strays;
}

/**
 * The test on one scheduled day, as the Editor's Pass shows it after a reading
 * lands on that day's Seed Word: the verdict as a sentence, and the word the
 * day would go to if it failed (null when it passes, or when no word of the
 * family passes and the day would be Free Play).
 */
export interface ScheduledSeedWordCheck {
  date: string;
  seed: string;
  rhymeKey: RhymeKey;
  passes: boolean;
  line: string;
  next: string | null;
}

/** Every scheduled day whose Seed Word is one of `words`, in Schedule order. */
export function daysSeededBy(days: readonly ScheduleDay[], words: readonly string[]): ScheduleDay[] {
  const asked = new Set(words.map(normaliseWord));
  return days.filter((day) => asked.has(normaliseWord(day.seed)));
}

/**
 * Run the test on every scheduled day whose Seed Word is one of `words`. The
 * Editor's Pass calls it after an add's or a correction's rebuild, because a
 * reading given to a scheduled Seed Word is one of the three times the test
 * runs (#264). It says what the day would become and writes nothing: the
 * Schedule is changed by the Seed Word run (`npm run seeds:test -- --write`),
 * on the same repair path as every other day.
 */
export function checkScheduledSeedWords(
  days: readonly ScheduleDay[],
  index: RhymeIndex,
  words: readonly string[],
): ScheduledSeedWordCheck[] {
  return daysSeededBy(days, words).map(({ date, seed, rhymeKey }) => {
    const test = testSeedWord(index, seed, rhymeKey);
    const family = index.familyOf(rhymeKey).members.map((m) => m.word);
    return {
      date,
      seed,
      rhymeKey,
      passes: test.passes,
      line: seedWordTestLine(seed, rhymeKey, test),
      next: test.passes ? null : seedWordFor(family, index, rhymeKey),
    };
  });
}

/**
 * The test after readings were written for `written`, as the add path and the
 * correction path both report it: off the index the rebuild wrote, opened only
 * when a written word is a scheduled Seed Word. Empty when none is. **Null when
 * one is and the test could not run** (the rebuild failed, or the index would
 * not open): a verdict read off the index from before the reading would be
 * about a word that no longer exists.
 */
export function seedWordChecksAfterWrite(
  days: readonly ScheduleDay[],
  written: readonly string[],
  rebuilt: boolean,
  openIndex: () => RhymeIndex,
): ScheduledSeedWordCheck[] | null {
  if (daysSeededBy(days, written).length === 0) return [];
  if (!rebuilt) return null;
  try {
    return checkScheduledSeedWords(days, openIndex(), written);
  } catch {
    return null;
  }
}

/**
 * `seedWordChecksAfterWrite`'s result as lines for a terminal, saying what the
 * Editor's Pass panel says: each day's verdict, where a failing day would go,
 * and the command that writes it. None when no scheduled Seed Word was written.
 */
export function seedWordCheckLines(checks: readonly ScheduledSeedWordCheck[] | null): string[] {
  if (checks === null) {
    return ["A reading was written to a scheduled Seed Word, but the Seed Word test could not run on the rebuilt index. Run npm run build:index, then npm run seeds:test."];
  }
  return checks.map((check) => {
    const head = `${check.date}, Seed Word ${check.seed}: ${check.line}`;
    if (check.passes) return head;
    const next = check.next === null
      ? "No word of its family passes, so the day would be Free Play."
      : `The day would keep ${check.rhymeKey} and go to ${check.next}.`;
    return `${head} ${next} Run npm run seeds:test -- --write to write it.`;
  });
}

/** The test's verdict as one sentence, for the build, the once-now run and the Editor's Pass. */
export function seedWordTestLine(word: string, rhymeKey: RhymeKey, test: SeedWordTest): string {
  if (test.passes) return `${word} passes the Seed Word test on ${rhymeKey}.`;
  switch (test.reason) {
    case "not-heard-one-way": {
      const said = test.strays
        .map(({ rhymeKey: key, words }) => {
          const shown = words.slice(0, 5).join(", ");
          return `on ${key} it rhymes with ${words.length} word(s) ${rhymeKey} does not (${shown}${words.length > 5 ? ", ..." : ""})`;
        })
        .join("; ");
      return `${word} is not heard one way: ${said}.`;
    }
    case "not-an-answer":
      return `${word} is not an Answer (knownness ${test.knownness ?? "none"}).`;
    case "unconfirmed-rhyme":
      return `${word} is listed as an Unconfirmed Rhyme.`;
  }
}
