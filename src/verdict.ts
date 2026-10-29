/**
 * The verdict contract. `adjudicate` returns a verdict, never a boolean: the
 * interface's quality depends on distinguishing *why* a Submission failed
 * (ADR-0005), so the reason is part of the contract, not reconstructed upstream.
 *
 * Every accepted verdict reports the pronunciation that justified it (as raw
 * phonemes and as a plain-English respelling), so the client can show the exact
 * reading it accepted — e.g. `tear` accepted for `beer` reports the /IH R/
 * reading, not the /EH R/ one.
 */

import type { Pronunciation } from "./phonology.ts";

/** The closed set of rejection reasons. Adding one is a deliberate change. */
export type RejectionReason =
  | "is-the-seed-word"
  | "already-submitted"
  | "malformed"
  | "not-a-known-word"
  | "proper-noun"
  | "does-not-rhyme";

/**
 * Each rejection reason in words a player can read. It sits here, beside the
 * closed set it covers, rather than inside a view: two clients render rejections
 * — the web shell and the `play` REPL — and while this table lived in the shell
 * the REPL printed the machine reason at the player instead.
 *
 * `Record<RejectionReason, string>` is what keeps it honest. The table is
 * exhaustive by construction, so adding a reason to the union above does not
 * compile until it has been given words, which is the only way a closed set
 * stays closed in practice (ADR-0005).
 *
 * Phrased as a sentence fragment completing "…", so a client can pair it with
 * the submitted word however it likes.
 */
export const REJECTION_MESSAGE: Record<RejectionReason, string> = {
  // Most rejected rhymes players Appeal are missing readings, so this claims
  // less than the old "doesn't rhyme" did (ADR-0020, #258).
  "does-not-rhyme": "not on our rhyme list",
  "is-the-seed-word": "that’s the Seed Word itself",
  "already-submitted": "you’ve already found that",
  "proper-noun": "proper nouns don’t count",
  "not-a-known-word": "not a word we know",
  malformed: "letters only, please",
};

/** How a Submission that rhymes and is a word is tiered (ADR-0003). */
export type Tier = "answer" | "bonus";

/**
 * The Answer/Bonus line: a word tiers to Answer when its knownness clears the
 * threshold. The *whole* of the rule — the lemma walk that finds a word's
 * knownness, and the absent-from-the-data default, are the index's job; this is
 * the comparison they end at.
 *
 * It sits here as one function rather than as an expression at each site because
 * two callers must agree about it exactly: the index tiers words with it, and
 * the Retrieval override layer's build-time guard asks it whether each sentinel
 * still lands on the Tier it was chosen for (ADR-0015). A guard that restated
 * the comparison would keep passing if the comparison itself changed, which is
 * a blind spot precisely where the guard is supposed to be loud.
 */
export function tierFor(knownness: number, knownnessThreshold: number): Tier {
  return knownness >= knownnessThreshold ? "answer" : "bonus";
}

/** A Submission that rhymes and is a word: it holds a Tier. */
export interface TieredVerdict {
  outcome: Tier;
  /** The pronunciation whose Rhyme Key matched the Seed Word. */
  pronunciation: Pronunciation;
  /** Plain-English respelling of that pronunciation, stress marked. */
  respelling: string;
  /** Letter count of the surface form — exposed so scoring can be built later. */
  length: number;
  /** Word-prevalence score, or null when the word is absent from the data. */
  knownness: number | null;
}

/**
 * A word accepted without Points that holds no Tier, so it carries no knownness.
 * A client shows it exactly as a Bonus Word, and it is never in the Reveal. Two
 * reasons make one, and the player is told neither:
 *
 * - `unconfirmed`, an Unconfirmed Rhyme (GLOSSARY.md): a word listed for the
 *   Seed Word's Rhyme Key in `data/unconfirmed-rhymes.txt` that does not rhyme
 *   there by itself. It carries no pronunciation: on a Missing Reading the game
 *   has none.
 * - `weak`, a Weak Rhyme (GLOSSARY.md, ADR-0020): a word that is no Rhyme,
 *   whose last syllable matches the Seed Word's under different stress. It is
 *   worked out at submission (`src/weakRhyme.ts`).
 */
export interface UntieredVerdict {
  outcome: "unconfirmed" | "weak";
  /** Letter count of the surface form, as a Tiered verdict reports it. */
  length: number;
}

/** Every verdict that accepts the Submission. */
export type AcceptedVerdict = TieredVerdict | UntieredVerdict;

export interface RejectedVerdict {
  outcome: "rejected";
  reason: RejectionReason;
  /**
   * For a near-miss (`does-not-rhyme`), the pronunciation the game used, so the
   * player can see why we disagree. Absent for reasons where no pronunciation
   * is relevant (malformed input, the seed word, a repeat).
   */
  pronunciation?: Pronunciation;
  respelling?: string;
}

export type Verdict = AcceptedVerdict | RejectedVerdict;

export function isAccepted(verdict: Verdict): verdict is AcceptedVerdict {
  return verdict.outcome !== "rejected";
}

/** True for an accepted word that holds a Tier, and so reports its reading. */
export function isTiered(verdict: Verdict): verdict is TieredVerdict {
  return verdict.outcome === "answer" || verdict.outcome === "bonus";
}

/** Every accepted outcome that scores nothing. A client shows all three as a Bonus Word. */
export type UnscoredOutcome = Exclude<AcceptedVerdict["outcome"], "answer">;

/**
 * The closed set of unscored outcomes, kept exhaustive by its type as
 * `REJECTION_MESSAGE` keeps the rejection reasons: an accepted outcome added to
 * the union does not compile until it is listed here, so the Appeal's
 * validation (`src/supplementCandidate.ts`) cannot fall behind it.
 */
const UNSCORED_OUTCOMES: Record<UnscoredOutcome, true> = { bonus: true, unconfirmed: true, weak: true };

/**
 * What an Appeal says the engine gave a word (GLOSSARY.md, Appeal): the
 * rejection reason, or the unscored outcome. Anything not counted as an Answer
 * can be Appealed (ADR-0020, #258).
 */
export type AppealedVerdict = RejectionReason | UnscoredOutcome;

/**
 * The verdict an Appeal of this Submission would carry, or null for an Answer,
 * which nobody Appeals. A client offers the Appeal control exactly when this is
 * not null, so a Bonus Word, a Weak Rhyme and an Unconfirmed Rhyme, which look
 * the same, all offer it.
 */
export function appealedVerdict(verdict: Verdict): AppealedVerdict | null {
  if (verdict.outcome === "rejected") return verdict.reason;
  if (verdict.outcome === "answer") return null;
  return verdict.outcome;
}

/** True for a string an Appeal may carry as its verdict. */
export function isAppealedVerdict(value: string): value is AppealedVerdict {
  return Object.hasOwn(REJECTION_MESSAGE, value) || Object.hasOwn(UNSCORED_OUTCOMES, value);
}
