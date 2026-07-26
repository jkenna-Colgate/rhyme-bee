/**
 * The stateful session facade the core (`session.ts`) always anticipated
 * ("extracted later when a browser is a second real caller"). `Game` bundles the
 * `(PuzzleContext, PlayState)` pair that every session accessor threads — a data
 * clump that always travels together — into one value, exposing `score()` /
 * `rank()` / `progress()` / `missedAnswers()` / `submit()` / `toResult()` as
 * methods so the REPL and the web shell stop passing both.
 *
 * It is a thin convenience over the pure functional core, not a replacement: each
 * method delegates straight to the same-named function in `session.ts`, which
 * stays intact and independently tested. A `Game` is itself a value — `submit`
 * returns a *new* Game rather than mutating, so the "snapshots are values"
 * property the core guarantees survives, and React can hold one in `useState`.
 */

import type { Puzzle, PuzzleEntry, RhymeIndex, SeedWord } from "./rhymeIndex.ts";
import {
  applySubmission,
  missedAnswers,
  progress,
  rank,
  score,
  startSession,
  toResult,
  emptyPlayState,
  type PlayState,
  type Progress,
  type PuzzleContext,
  type PuzzleResult,
  type Rank,
  type ScoringConfig,
  type SubmissionResult,
} from "./session.ts";

/**
 * One Puzzle in progress: an immutable `PuzzleContext` plus the current
 * `PlayState`. Construct via `startGame` for a fresh game, or directly from a
 * rebuilt context and a deserialized `PlayState` to rehydrate a saved one.
 */
export class Game {
  constructor(
    readonly context: PuzzleContext,
    readonly state: PlayState = emptyPlayState,
  ) {}

  /** The built Puzzle (Seed Word, respelling, Answers, Bonus Words). */
  get puzzle(): Puzzle {
    return this.context.puzzle;
  }

  /** The pinned Seed Word this game is built around. */
  get seed(): SeedWord {
    return this.context.seed;
  }

  /** The fixed Rank denominator: the summed points of every Answer. */
  get maxScore(): number {
    return this.context.maxScore;
  }

  /** The Answer words found so far, in the order they were found. */
  get foundAnswers(): readonly string[] {
    return this.state.foundAnswers;
  }

  /** The Bonus Words collected so far, in the order they were found. */
  get foundBonus(): readonly string[] {
    return this.state.foundBonus;
  }

  /** The points a given Answer word is worth (0 if it is not an Answer). */
  pointsFor(word: string): number {
    return this.context.answerScores.get(word) ?? 0;
  }

  /** The player's Score: the summed points of the Answers found. */
  score(): number {
    return score(this.context, this.state);
  }

  /** The player's resolved Rank on the ladder. */
  rank(): Rank {
    return rank(this.context, this.state);
  }

  /** How far through the Puzzle: Answers found of the total, Bonus collected. */
  progress(): Progress {
    return progress(this.context, this.state);
  }

  /** The Answers not yet found, in the Puzzle's order — the end-of-game reveal. */
  missedAnswers(): PuzzleEntry[] {
    return missedAnswers(this.context, this.state);
  }

  /** Snapshot the game into a durable, value-typed `PuzzleResult`. */
  toResult(meta: { date: string }): PuzzleResult {
    return toResult(this.context, this.state, meta);
  }

  /**
   * Apply a Submission. Returns the lean `SubmissionResult` and the Game to carry
   * forward: a new Game when the state advanced, or `this` unchanged when the
   * Submission was rejected (the core returns the same state on a rejection, so
   * the same instance flows on).
   */
  submit(submission: string): { game: Game; result: SubmissionResult } {
    const { state, result } = applySubmission(this.context, this.state, submission);
    const game = state === this.state ? this : new Game(this.context, state);
    return { game, result };
  }
}

/**
 * Start a fresh Game: build the session context (pinning the Seed if given a raw
 * word) and wrap it with an empty play-state. The tuning `config` is forwarded to
 * `startSession` unchanged.
 */
export function startGame(
  index: RhymeIndex,
  seed: string | SeedWord,
  config?: ScoringConfig,
): Game {
  return new Game(startSession(index, seed, config));
}
