/**
 * The Session + scoring layer: a pure functional core over `RhymeIndex`. A
 * Session is one player's play-through of a Puzzle (CONTEXT.md); this module
 * gives the engine a memory of one in progress — which words a player has found —
 * and derives Score, Rank, progress, and a final result from that memory. It
 * introduces no seam below the index (it reuses `adjudicate`, `buildPuzzle` and
 * `pinSeed` unchanged) and holds no UI, audio, or persistence — only the logic of
 * playing and scoring one Puzzle (ADR-0006; respects ADR-0003/0004).
 *
 * Two structures carry the state, neither a glossary term (both are seams):
 *   - `PuzzleContext` — immutable, built once at Session start, NOT serialized.
 *   - `PlayState` — tiny, serializable, the single source of truth. Only the
 *     found words are stored; Score and Rank are never denormalised into it.
 *
 * The `Session` class at the foot of the file is a thin, immutable facade that
 * bundles the `(PuzzleContext, PlayState)` pair the pure functions thread — so
 * callers (the REPL and the web shell) hold one value and call `session.score()`
 * rather than passing both. It adds no logic; every method delegates to the free
 * function of the same name above it.
 */

import { normaliseWord } from "./cmudict.ts";
import type { Puzzle, PuzzleEntry, RhymeIndex, SeedWord } from "./rhymeIndex.ts";
import {
  DEFAULT_SCORING_CONFIG,
  scoreEntry,
  type ScoringConfig,
} from "./scoring.ts";
import { isAccepted, type Verdict } from "./verdict.ts";

// The scoring primitive (`scoreEntry`, `ScoringConfig`, `DEFAULT_SCORING_CONFIG`,
// `RankTier`, `DEFAULT_RANK_LADDER`) lives in `scoring.ts` so curation scores a
// candidate's Difficulty with the identical points function (ADR-0007). They are
// re-exported here so the session's existing public surface is unchanged.
export {
  DEFAULT_RANK_LADDER,
  DEFAULT_SCORING_CONFIG,
  scoreEntry,
  type RankTier,
  type ScoringConfig,
} from "./scoring.ts";

/**
 * Immutable per-session context, built once by `startSession`. Carries the
 * pinned Seed Word, the built Puzzle, the index and scoring config, and two
 * precomputes derived from the Answers: `answerScores` (each Answer word -> its
 * points) and `maxScore` (their sum — the fixed Rank denominator). Not
 * serialized; rebuild it at session start instead.
 */
export interface PuzzleContext {
  index: RhymeIndex;
  seed: SeedWord;
  puzzle: Puzzle;
  config: ScoringConfig;
  /** Each Answer word -> the points it is worth. The single basis of Score and maxScore. */
  answerScores: ReadonlyMap<string, number>;
  maxScore: number;
}

/**
 * The serializable single source of truth: the found Answer words and found
 * Bonus Words, as arrays (set semantics — no duplicates — enforced by the
 * reducer). Nothing else; Score and Rank are derived on demand.
 */
export interface PlayState {
  foundAnswers: string[];
  foundBonus: string[];
}

/** The starting state: nothing found yet. */
export const emptyPlayState: PlayState = { foundAnswers: [], foundBonus: [] };

/**
 * A resolved Rank: which rung of the ladder the player is on, plus its label and
 * threshold. `tier` is the zero-based rung index (named to match the Rank shape
 * the session issue pins, `{ tier, label, threshold }`).
 */
export interface Rank {
  tier: number;
  label: string;
  threshold: number;
}

/** How far through the Puzzle: Answers found of the total, and Bonus Words collected. */
export interface Progress {
  found: number;
  totalAnswers: number;
  foundBonus: number;
}

/** A Rank crossing: the rung left and the rung reached. */
export interface RankChange {
  from: Rank;
  to: Rank;
}

/**
 * What a single Submission did — only the transient "what just happened". The
 * new durable totals (Score, Rank, progress) are read from the returned state
 * via selectors, never duplicated here.
 */
export interface SubmissionResult {
  /** The submitted word, echoed. */
  word: string;
  verdict: Verdict;
  /** Points gained; always present (0 for a Bonus Word or a rejection). */
  scoreDelta: number;
  /** Present ONLY when this Submission crossed a Rank threshold (Rank is monotonic). */
  rankChange?: RankChange;
}

/** The durable record of a finished game — a snapshot, so retuning never rewrites it. */
export interface PuzzleResult {
  date: string;
  seed: string;
  finalScore: number;
  finalRank: Rank;
  found: number;
  totalAnswers: number;
}

/**
 * Start a session: pin the Seed Word (if given a raw word), build the Puzzle, and
 * precompute each Answer's points and their sum. Pass a pre-pinned `SeedWord` to
 * disambiguate a word that reads two ways (e.g. `bass`).
 */
export function startSession(
  index: RhymeIndex,
  seed: string | SeedWord,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): PuzzleContext {
  const pinned = typeof seed === "string" ? index.pinSeed(seed) : seed;
  const puzzle = index.buildPuzzle(pinned);

  const answerScores = new Map<string, number>();
  let maxScore = 0;
  for (const answer of puzzle.answers) {
    const points = scoreEntry(answer, config);
    answerScores.set(answer.word, points);
    maxScore += points;
  }
  return { index, seed: pinned, puzzle, config, answerScores, maxScore };
}

/**
 * Apply a Submission to the current state. Returns a new `PlayState` (the input
 * is never mutated) and a lean `SubmissionResult`. The union of found Answers and
 * Bonus Words is passed to `adjudicate` as `alreadySubmitted`, so a found word is
 * rejected as a repeat while a previously *rejected* word — never stored — is
 * re-adjudicated on its real merits.
 */
export function applySubmission(
  context: PuzzleContext,
  state: PlayState,
  submission: string,
): { state: PlayState; result: SubmissionResult } {
  const alreadySubmitted = new Set<string>([...state.foundAnswers, ...state.foundBonus]);
  const verdict = context.index.adjudicate(context.seed, submission, alreadySubmitted);

  if (!isAccepted(verdict)) {
    return { state, result: { word: submission, verdict, scoreDelta: 0 } };
  }

  // Store the normalised form so repeat-detection and score lookup both line up
  // with `adjudicate` and the built Puzzle, which use the same normalisation.
  const word = normaliseWord(submission);
  const nextState: PlayState =
    verdict.outcome === "answer"
      ? { foundAnswers: [...state.foundAnswers, word], foundBonus: state.foundBonus }
      : { foundAnswers: state.foundAnswers, foundBonus: [...state.foundBonus, word] };

  const rankBefore = rank(context, state);
  const rankAfter = rank(context, nextState);
  const result: SubmissionResult = {
    word: submission,
    verdict,
    scoreDelta: score(context, nextState) - score(context, state),
  };
  if (rankAfter.tier !== rankBefore.tier) {
    result.rankChange = { from: rankBefore, to: rankAfter };
  }
  return { state: nextState, result };
}

/** The player's Score: the summed points of the Answers they have found. */
export function score(context: PuzzleContext, state: PlayState): number {
  let total = 0;
  for (const word of state.foundAnswers) total += context.answerScores.get(word) ?? 0;
  return total;
}

/**
 * The player's Rank: `Score ÷ maxScore` as a percentage, resolved to the highest
 * rung whose threshold it has reached (`>= threshold` triggers). Percentage of
 * the maximum self-normalises across Puzzle sizes. When `maxScore` is 0 (cannot
 * occur for a banded Puzzle) the bottom rung is returned rather than dividing by
 * zero.
 */
export function rank(context: PuzzleContext, state: PlayState): Rank {
  const ladder = context.config.rankLadder;
  const pct = context.maxScore === 0 ? 0 : (score(context, state) / context.maxScore) * 100;

  let chosen = 0;
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i];
    if (rung === undefined) break;
    if (pct >= rung.threshold) chosen = i;
    else break;
  }
  const rung = ladder[chosen] ?? { threshold: 0, label: "" };
  return { tier: chosen, label: rung.label, threshold: rung.threshold };
}

/** How far through the Puzzle: Answers found of the total, and Bonus Words collected. */
export function progress(context: PuzzleContext, state: PlayState): Progress {
  return {
    found: state.foundAnswers.length,
    totalAnswers: context.puzzle.answers.length,
    foundBonus: state.foundBonus.length,
  };
}

/**
 * The Answers the player has not found — the Puzzle's Answers minus the found
 * ones, in the Puzzle's own order. The reveal shown at the end of a game; a
 * derivation over play-state that belongs in the core, not in a client.
 */
export function missedAnswers(context: PuzzleContext, state: PlayState): PuzzleEntry[] {
  const found = new Set(state.foundAnswers);
  return context.puzzle.answers.filter((answer) => !found.has(answer.word));
}

/**
 * Snapshot a finished game into a durable `PuzzleResult`. It reads Score, Rank
 * and progress at the moment it is called and freezes them into plain values, so
 * a later scoring retune never rewrites a past result.
 */
export function toResult(
  context: PuzzleContext,
  state: PlayState,
  meta: { date: string },
): PuzzleResult {
  const { found, totalAnswers } = progress(context, state);
  return {
    date: meta.date,
    seed: context.seed.word,
    finalScore: score(context, state),
    finalRank: rank(context, state),
    found,
    totalAnswers,
  };
}

// --- The Session facade --------------------------------------------------------

/**
 * A Session (CONTEXT.md): one player's play-through of a Puzzle, as one value.
 * It bundles the immutable `PuzzleContext` and the current `PlayState` — the pair
 * every accessor above threads — and exposes `score()` / `rank()` / `progress()`
 * / `missedAnswers()` / `submit()` / `toResult()` as methods, so callers stop
 * passing both. It is a thin convenience over the pure core, not a replacement:
 * each method delegates straight to the free function of the same name.
 *
 * A Session is itself a value. `submit` returns a *new* Session rather than
 * mutating, so the "snapshots are values" property the core guarantees survives
 * and React can hold one in `useState`. Start one with `Session.start`, or
 * reconstruct a saved one with `new Session(context, deserializedState)`.
 */
export class Session {
  constructor(
    readonly context: PuzzleContext,
    readonly state: PlayState = emptyPlayState,
  ) {}

  /** Start a fresh Session: build the context (pinning the Seed if raw), empty state. */
  static start(index: RhymeIndex, seed: string | SeedWord, config?: ScoringConfig): Session {
    return new Session(startSession(index, seed, config));
  }

  /** The built Puzzle (Seed Word, respelling, Answers, Bonus Words). */
  get puzzle(): Puzzle {
    return this.context.puzzle;
  }

  /** The pinned Seed Word this Session is built around. */
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

  /** Snapshot the Session into a durable, value-typed `PuzzleResult`. */
  toResult(meta: { date: string }): PuzzleResult {
    return toResult(this.context, this.state, meta);
  }

  /**
   * Apply a Submission. Returns the lean `SubmissionResult` and the Session to
   * carry forward: a new Session when the state advanced, or `this` unchanged
   * when the Submission was rejected (the core returns the same state on a
   * rejection, so the same instance flows on).
   */
  submit(submission: string): { session: Session; result: SubmissionResult } {
    const { state, result } = applySubmission(this.context, this.state, submission);
    const session = state === this.state ? this : new Session(this.context, state);
    return { session, result };
  }
}
