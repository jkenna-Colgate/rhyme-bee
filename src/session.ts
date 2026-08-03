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
 *     found words and whether the Session has ended are stored; Score and Rank
 *     are never denormalised into it.
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
 * The serializable single source of truth: the found Answer words, the found
 * Bonus Words (both arrays with set semantics — no duplicates — enforced by the
 * reducer), and whether the Session is over. Nothing else; Score and Rank are
 * derived on demand.
 *
 * `ended` is the whole of "the game is finished": it is set by `endSession` when
 * the player takes the Reveal (CONTEXT.md), and it makes `applySubmission`
 * decline before it ever adjudicates. Being over is a property of the Session,
 * not of the word submitted, so it deliberately stays out of the rejection
 * vocabulary.
 */
export interface PlayState {
  foundAnswers: string[];
  foundBonus: string[];
  ended: boolean;
}

/** The starting state: nothing found yet, and still playable. */
export const emptyPlayState: PlayState = { foundAnswers: [], foundBonus: [], ended: false };

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

/**
 * Where a Session stands as a whole (CONTEXT.md). Derived, never stored —
 * `PlayState` keeps the finds and the `ended` flag, and this reads them.
 *
 * `complete` means every Answer is found, whether or not the player has since
 * taken the Reveal: finishing the Puzzle and then asking to see the Bonus Words
 * is not giving up, and must not be worded as if it were. `given-up` is the
 * Reveal taken with Answers still missing. Everything else is `in-progress`,
 * including a fresh Session on a Puzzle with no Answers at all — nobody has
 * completed anything there.
 *
 * Bonus Words never enter it. They are celebrated, not counted (CONTEXT.md), so
 * collecting one after the last Answer leaves the outcome exactly where it was.
 */
export type SessionOutcome = "in-progress" | "complete" | "given-up";

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
 *
 * An ended Session declines: the state comes back unchanged and `result` is
 * `null`, meaning "no Submission happened". The guard sits above `adjudicate`
 * deliberately — a Verdict answers "does this word rhyme?", and "the game is
 * over" is not an answer to that question, so it never enters the closed
 * rejection set. Clients should stop offering entry once a Session has ended
 * rather than render a null result per attempt.
 */
export function applySubmission(
  context: PuzzleContext,
  state: PlayState,
  submission: string,
): { state: PlayState; result: SubmissionResult | null } {
  if (state.ended) return { state, result: null };

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
      ? { ...state, foundAnswers: [...state.foundAnswers, word] }
      : { ...state, foundBonus: [...state.foundBonus, word] };

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
 * How the Session stands: in progress, complete, or given up. Derived here once,
 * beside Score, Rank and progress, because both clients were computing it and
 * neither by the same formula — the shell compared found Answers against the
 * total, the REPL asked whether anything was missed. Those are the same question
 * with two answers waiting to disagree.
 */
export function outcome(context: PuzzleContext, state: PlayState): SessionOutcome {
  const { found, totalAnswers } = progress(context, state);
  if (totalAnswers > 0 && found >= totalAnswers) return "complete";
  return state.ended ? "given-up" : "in-progress";
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
 * The Bonus Words the player never reached — the mirror of `missedAnswers` over
 * the Puzzle's Bonus Words, same entry type, same Puzzle order. The other half of
 * the Reveal, and a derivation for the same reason: a client subtracting the
 * collected words from `puzzle.bonusWords` would be doing game logic.
 */
export function missedBonusWords(context: PuzzleContext, state: PlayState): PuzzleEntry[] {
  const found = new Set(state.foundBonus);
  return context.puzzle.bonusWords.filter((bonus) => !found.has(bonus.word));
}

/**
 * End the Session — what taking the Reveal does to play-state (CONTEXT.md). The
 * finds are kept exactly as they are, so Score, Rank and progress freeze at the
 * values they already held and the Reveal can show the misses beside them; only
 * further Submissions are shut off. Idempotent: an already-ended state is
 * returned as-is, so re-ending is a no-op rather than a new object.
 */
export function endSession(state: PlayState): PlayState {
  return state.ended ? state : { ...state, ended: true };
}

/**
 * Snapshot a finished game into a durable `PuzzleResult`. It reads Score, Rank
 * and progress at the moment it is called and freezes them into plain values, so
 * a later scoring retune never rewrites a past result.
 *
 * It deliberately does not record whether the game ended in a Reveal. Nothing
 * reads such a flag — Puzzle history is a separate concern that does not exist
 * yet — and `found` against `totalAnswers` already shows a snapshot taken short
 * of completion.
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
 * / `missedAnswers()` / `missedBonusWords()` / `submit()` / `end()` /
 * `toResult()` as methods, so callers stop passing both. It is a thin
 * convenience over the pure core, not a replacement: each method delegates
 * straight to the free function of the same name.
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

  /**
   * Whether this Session is over — the player took the Reveal. Score and Rank are
   * frozen and `submit` no longer lands; a client reads this to stop offering
   * entry at all, rather than to explain a refusal after the fact.
   */
  get ended(): boolean {
    return this.state.ended;
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

  /**
   * Where the Session stands: `in-progress`, `complete` or `given-up`. Clients
   * read this rather than reconstructing it from progress or from what the
   * Reveal has left over.
   */
  outcome(): SessionOutcome {
    return outcome(this.context, this.state);
  }

  /** The Answers not yet found, in the Puzzle's order — half of the Reveal. */
  missedAnswers(): PuzzleEntry[] {
    return missedAnswers(this.context, this.state);
  }

  /** The Bonus Words never collected, in the Puzzle's order — the other half. */
  missedBonusWords(): PuzzleEntry[] {
    return missedBonusWords(this.context, this.state);
  }

  /**
   * Take the Reveal: a *new*, ended Session with the same finds, Score and Rank,
   * which accepts no further Submissions. The Session this was called on is a
   * value and stays playable, so a caller that has not committed the result can
   * still discard the ending. Already ended, `this` comes back unchanged.
   */
  end(): Session {
    const state = endSession(this.state);
    return state === this.state ? this : new Session(this.context, state);
  }

  /** Snapshot the Session into a durable, value-typed `PuzzleResult`. */
  toResult(meta: { date: string }): PuzzleResult {
    return toResult(this.context, this.state, meta);
  }

  /**
   * Apply a Submission. Returns the lean `SubmissionResult` and the Session to
   * carry forward: a new Session when the state advanced, or `this` unchanged
   * when the Submission was rejected (the core returns the same state on a
   * rejection, so the same instance flows on). On an ended Session nothing lands
   * and `result` is `null` — see `applySubmission`.
   */
  submit(submission: string): { session: Session; result: SubmissionResult | null } {
    const { state, result } = applySubmission(this.context, this.state, submission);
    const session = state === this.state ? this : new Session(this.context, state);
    return { session, result };
  }
}
