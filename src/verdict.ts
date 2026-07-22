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
