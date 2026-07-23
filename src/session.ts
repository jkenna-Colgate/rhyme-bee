/**
 * The game-session + scoring layer: a pure functional core over `RhymeIndex`.
 * It gives the engine a memory of a game in progress — which words a player has
 * found — and derives Score, Rank, progress, and a final result from that memory.
 * It introduces no seam below the index (it reuses `adjudicate`, `buildPuzzle`
 * and `pinSeed` unchanged) and holds no UI, audio, or persistence — only the
 * logic of playing and scoring one Puzzle (ADR-0006; respects ADR-0003/0004).
 *
 * Two structures carry the state, neither a glossary term (both are seams):
 *   - `PuzzleContext` — immutable, built once at session start, NOT serialized.
 *   - `PlayState` — tiny, serializable, the single source of truth. Only the
 *     found words are stored; Score and Rank are never denormalised into it.
 */

import { normaliseWord } from "./cmudict.ts";
import type { Puzzle, PuzzleEntry, RhymeIndex, SeedWord } from "./rhymeIndex.ts";
import { isAccepted, type Verdict } from "./verdict.ts";

/** One rung of the Rank ladder: the percentage-of-maximum it triggers at. */
export interface RankTier {
  threshold: number;
  label: string;
}

/**
 * The scoring tuning knobs — configuration with documented defaults, not
 * constants, so the game can be tuned against real play without a code change.
 */
export interface ScoringConfig {
  /** An Answer is rare when its knownness sits below this cutoff. */
  rareKnownnessCutoff: number;
  /** Flat points a rare Answer earns on top of its length. */
  rareBonus: number;
  /** Ordered rungs (ascending threshold); Rank is the highest rung reached. */
  rankLadder: RankTier[];
}

/**
 * The default Rank ladder. Thresholds mirror Spelling Bee — the top *named* tier
 * sits at 70% so it is aspirational, and the 100% tier is reached only by finding
 * every Answer (every Answer scores positive, so 100% means a perfect game).
 *
 * The labels are PROVISIONAL placeholders. Finalising them is deferred (see the
 * session module issue / ADR-0006): they must form an instantly-legible
 * progression where higher unambiguously reads as better. They are pure config
 * data and do not block the module.
 */
export const DEFAULT_RANK_LADDER: RankTier[] = [
  { threshold: 0, label: "Beginner" },
  { threshold: 2, label: "Good Start" },
  { threshold: 5, label: "Moving Up" },
  { threshold: 8, label: "Good" },
  { threshold: 15, label: "Solid" },
  { threshold: 25, label: "Nice" },
  { threshold: 40, label: "Great" },
  { threshold: 50, label: "Amazing" },
  { threshold: 70, label: "Genius" },
  { threshold: 100, label: "All Answers" },
];

/** The shipped defaults; every knob is expected to be tuned against real play. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  rareKnownnessCutoff: 0.7,
  rareBonus: 2,
  rankLadder: DEFAULT_RANK_LADDER,
};

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

/** The points an Answer is worth: length, plus a flat bonus when it is rare (ADR-0006). */
function scoreEntry(entry: PuzzleEntry, config: ScoringConfig): number {
  // Every Answer carries a non-null knownness (a word absent from the prevalence
  // data always tiers to Bonus, ADR-0003), so the rare test is a clean numeric
  // comparison; the null guard only ever fires for a defensive caller.
  const rare = entry.knownness !== null && entry.knownness < config.rareKnownnessCutoff;
  return entry.length + (rare ? config.rareBonus : 0);
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
