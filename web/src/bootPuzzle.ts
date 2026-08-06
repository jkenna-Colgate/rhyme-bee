/**
 * Boot policy: which Puzzle a player opens, and why (#124). A player meets the
 * Daily Puzzle scheduled for their own local calendar date — or, when the
 * schedule has nothing for that date (an early visit before the run starts, one
 * after it ends, or a schedule/index disagreement), Free Play: a random draw
 * from the shared in-band Seed pool. The same draw is also what a player reaches
 * for on purpose, once, via the "Free play" control — Free Play is both the
 * automatic fallback and something chosen.
 *
 * A first ever visit would get the Tutorial ahead of either, but the Tutorial is
 * switched off for the playtest (#130) — see `TUTORIAL_ENABLED` below.
 *
 * Every Seed is resolved to a pinned `SeedWord` here, at this one boundary,
 * rather than carried onward as a bare string for a caller to pin later.
 */

import type { FamilyEntry } from "../../src/curation.ts";
import type { RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import { parseSchedule, seedForDate, type Schedule } from "../../src/schedule.ts";
import scheduleArtifact from "../../data/schedule.json";

/**
 * Which of the three kinds of Puzzle this is. They are genuinely three and not
 * two: the Tutorial and Free Play are both dateless, so a date alone cannot
 * tell them apart, and telling a first-time player they are in Free Play is a
 * lie the view was previously forced into.
 */
export type PuzzleKind = "daily" | "tutorial" | "free";

/** The Puzzle to open: which kind, and its Seed — always a pinned `SeedWord`,
 * resolved here rather than threaded as a bare string for a later caller to
 * pin. */
export interface OpeningPuzzle {
  kind: PuzzleKind;
  /**
   * The calendar date this Puzzle is filed under, and the key `usePuzzleSession`
   * saves its Session beneath. Only a `daily` Puzzle has one; the other two
   * kinds carry null and are deliberately not saved.
   */
  date: string | null;
  seed: SeedWord;
}

/** The Tutorial, the first-run Puzzle, is always seeded with `ate` (CONTEXT.md). */
const TUTORIAL_SEED = "ate";

/**
 * Whether a first ever visit opens the Tutorial (#130). Off for the playtest:
 * testers are handed the game with context, so a warm-up Puzzle standing
 * between them and the real one costs more than it teaches. Its one lesson —
 * that the game is about sound and not spelling — has moved into the ordinary
 * start-gate copy, where every player reads it every visit.
 *
 * A named constant rather than a deleted branch, deliberately. `tutorialPuzzle`,
 * the first-visit flag and the `tutorial` `PuzzleKind` all stay live and
 * dormant, so bringing the Tutorial back after the playtest is this one word.
 * Do not "tidy up" what then looks like an unreachable path.
 */
export const TUTORIAL_ENABLED = false;

/**
 * The reviewed schedule, read once at module load. It is committed data that
 * ships inside the bundle, so there is no fetch and no waiting for it.
 */
export const SCHEDULE: Schedule | null = parseSchedule(scheduleArtifact);

/** The Tutorial: seeded with `ate`, no date, not persisted (CONTEXT.md). */
export function tutorialPuzzle(index: RhymeIndex): OpeningPuzzle {
  return { kind: "tutorial", date: null, seed: index.pinSeed(TUTORIAL_SEED) };
}

/**
 * A free-play draw from the shared in-band Seed pool (#33): a family's
 * representative, pinned to the family's own Rhyme Key so an ambiguous
 * representative cannot misfire. An empty pool falls back to the Tutorial
 * Seed rather than leaving Free Play with nothing to open.
 */
function drawFreeSeed(index: RhymeIndex, pool: readonly FamilyEntry[]): SeedWord {
  if (pool.length === 0) return index.pinSeed(TUTORIAL_SEED);
  const family = pool[Math.floor(Math.random() * pool.length)]!;
  return { word: family.representative, rhymeKey: family.rhymeKey };
}

/** Free Play: a random draw, dateless, never persisted. */
export function freePlayPuzzle(index: RhymeIndex, pool: readonly FamilyEntry[]): OpeningPuzzle {
  return { kind: "free", date: null, seed: drawFreeSeed(index, pool) };
}

/**
 * The Daily Puzzle for the player's own local calendar date, or null when
 * there is not one to open — the date falls outside the run, or the built
 * index no longer carries the Seed the schedule names.
 */
export function dailyPuzzle(
  index: RhymeIndex,
  schedule: Schedule | null,
  date: string,
): OpeningPuzzle | null {
  const scheduled = seedForDate(schedule, date);
  if (scheduled === null) return null;
  try {
    return { kind: "daily", date, seed: index.pinSeed(scheduled.word, scheduled.rhymeKey) };
  } catch (err) {
    // Silent in production — one free-play Puzzle beats a white screen. But in
    // development this means the schedule and the built index disagree, which
    // is a bug in the pair and not something to discover from a player.
    if (import.meta.env.DEV) {
      console.warn(
        `[rhyme-bee] schedule/index mismatch for ${date}: the index does not carry ` +
          `Seed Word "${scheduled.word}" on Rhyme Key ${scheduled.rhymeKey}. ` +
          `Falling back to free play. Rebuild the index, or rebuild the schedule ` +
          `against this index.`,
        err,
      );
    }
    return null;
  }
}

/**
 * The Puzzle a player lands on: today's Daily Puzzle, and Free Play when there
 * is no Daily Puzzle to open — an early visit before the start date, a visit
 * after the run's days are up, or a schedule the index has fallen out of step
 * with. An early click is not a dead end. A first ever visit takes the Tutorial
 * ahead of both, when `TUTORIAL_ENABLED` says so.
 *
 * Takes `daily` already resolved rather than recomputing it, because the
 * caller needs that same answer a second time — for the control that leaves
 * the Tutorial or Free Play for today's Puzzle — and resolving it here too
 * would pin the schedule's Seed twice on every render for nothing.
 */
export function openingPuzzle(
  index: RhymeIndex,
  pool: readonly FamilyEntry[],
  daily: OpeningPuzzle | null,
  firstVisit: boolean,
): OpeningPuzzle {
  // A first ever visit gets the Tutorial whatever the schedule says: it exists
  // to teach that the game is about sound and not spelling, and that lesson
  // has to land before the first real Puzzle. It carries no date, so it is
  // *unpersisted* — never filed under the day, and the player still meets
  // today's Puzzle after it. Not unscored: Score and Rank render on the
  // Tutorial exactly as they do on a scheduled Puzzle, though CONTEXT.md calls
  // the Tutorial unscored. Whether the code or the glossary should give way is
  // #125 — dormant while the constant is off, since this branch cannot be
  // taken.
  if (TUTORIAL_ENABLED && firstVisit) return tutorialPuzzle(index);
  return daily ?? freePlayPuzzle(index, pool);
}
