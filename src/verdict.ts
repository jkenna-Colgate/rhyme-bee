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
  "does-not-rhyme": "doesn’t rhyme with the Seed Word",
  "is-the-seed-word": "that’s the Seed Word itself",
  "already-submitted": "you’ve already found that",
  "proper-noun": "proper nouns don’t count",
  "not-a-known-word": "not a word we know",
  malformed: "letters only, please",
};

/** How a Submission that rhymes and is a word is tiered (ADR-0003). */
export type Tier = "answer" | "bonus";

export interface AcceptedVerdict {
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
