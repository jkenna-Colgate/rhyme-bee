/**
 * The shared scoring primitive: the per-Answer points function and its tuning
 * knobs, extracted from the session layer so the two callers that must score
 * identically share the exact same code (ADR-0007).
 *
 * The session (scoring a game in progress) and curation (scoring a candidate's
 * Difficulty) both import `scoreEntry` from here. That shared points function is
 * what makes the `1 − Difficulty` identity exact: Difficulty is defined in the
 * game's own Score currency, so it must be computed with the very function the
 * game scores with, not a parallel re-implementation.
 */

import type { PuzzleEntry } from "./rhymeIndex.ts";

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

/** The points an Answer is worth: length, plus a flat bonus when it is rare (ADR-0006). */
export function scoreEntry(entry: PuzzleEntry, config: ScoringConfig): number {
  // Every Answer carries a non-null knownness (a word absent from the prevalence
  // data always tiers to Bonus, ADR-0003), so the rare test is a clean numeric
  // comparison; the null guard only ever fires for a defensive caller.
  const rare = entry.knownness !== null && entry.knownness < config.rareKnownnessCutoff;
  return entry.length + (rare ? config.rareBonus : 0);
}
