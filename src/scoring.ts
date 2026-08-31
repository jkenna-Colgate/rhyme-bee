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
 * The labels are a rhymer's career, from a standing start to the name that ends
 * the argument. Seniority in a craft is a dimension that sorts without being
 * taught, which a scale of vague approval ("Good, Solid, Nice") is not. The
 * bottom rung states a fact rather than passing a verdict — everyone begins a
 * beginner — and the top one scans as a brag outside the game. Two things that read as
 * mistakes are not: `Rhymster` is coined and has no second `e`, and Shakespeare
 * is a Proper Noun, which the game refuses as a Submission but not as praise.
 * No rung may reach for bee imagery, or for any vocabulary of rhyme *quality* —
 * the game has exactly one kind of rhyme and the ladder must not imply others.
 *
 * They stay pure config data: nothing outside this array knows a rung by name.
 */
export const DEFAULT_RANK_LADDER: RankTier[] = [
  { threshold: 0, label: "Beginner" },
  { threshold: 2, label: "First Verse" },
  { threshold: 5, label: "Budding Poet" },
  { threshold: 8, label: "Rhymster" },
  { threshold: 15, label: "Silver Tongue" },
  { threshold: 25, label: "Troubadour" },
  { threshold: 40, label: "Bard" },
  { threshold: 50, label: "Wordsmith" },
  { threshold: 70, label: "Laureate" },
  { threshold: 100, label: "Shakespeare" },
];

/** The shipped defaults; every knob is expected to be tuned against real play. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  rareKnownnessCutoff: 0.7,
  rareBonus: 2,
  rankLadder: DEFAULT_RANK_LADDER,
};

/** The minimum an Answer must expose to be scored: its length and knownness. */
export interface Scorable {
  length: number;
  knownness: number | null;
}

/**
 * The single rare line — an Answer is rare when its knownness sits below the
 * cutoff. This is the *one* notion of "rare": both the scoring bonus and the
 * curation Difficulty draw the line here, so they can never diverge (ADR-0007).
 *
 * Every Answer carries a non-null knownness (a word absent from the prevalence
 * data always tiers to Bonus, ADR-0003), so this is a clean numeric comparison;
 * the null guard only ever fires for a defensive caller.
 */
export function isRare(knownness: number | null, config: ScoringConfig): boolean {
  return knownness !== null && knownness < config.rareKnownnessCutoff;
}

/** The points an Answer is worth: length, plus a flat bonus when it is rare (ADR-0006). */
export function scoreEntry(entry: Scorable, config: ScoringConfig): number {
  return entry.length + (isRare(entry.knownness, config) ? config.rareBonus : 0);
}
