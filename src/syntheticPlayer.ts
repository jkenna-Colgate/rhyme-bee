/**
 * The Synthetic Player (GLOSSARY.md) as an instrument (#250): the prompt that
 * casts a model as an ordinary player, how its word list is read, and the play
 * loop, which submits every word to the real engine through `session.ts`. It
 * calls no model and writes no file; `scripts/synthetic-player.ts` does both.
 *
 * Same knowledge, different play. The prompt gives what a player has (the Seed
 * Word and how it is said) and the model gives all its words at once, with no
 * verdict shown after any of them. The prompt and the loop are carried across
 * verbatim from `prototype/223-synthetic-player`.
 */

import { applySubmission, emptyPlayState, rank, score, type PuzzleContext, type SubmissionResult } from "./session.ts";
import type { RejectionReason, Verdict } from "./verdict.ts";

export function playerPrompt(seedWord: string, respelling: string): string {
  return [
    `You are playing a daily word game called Rhyming Bee. You are an ordinary adult American player:`,
    `not a poet, no rhyming dictionary, no internet. The game shows you one word and reads it aloud:`,
    ``,
    `  "${seedWord}" (pronounced ${respelling})`,
    ``,
    `Type in as many real English words as you can that rhyme with it. Names don't count.`,
    `Play the way you really would: write every word you would come up with and type in during a relaxed`,
    `session of about fifteen minutes, and stop when you would run out of ideas.`,
    `Output only the words, one per line, lowercase, nothing else.`,
  ].join("\n");
}

/** The words in a reply: one a line, lower-cased, list marks taken off, anything else dropped. */
export function parsePlayerReply(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase().replace(/^[-*\d.\s]+/, ""))
    .filter((w) => /^[a-z' -]+$/.test(w));
}

/** One Submission the game did not count as an Answer, and the verdict it gave. */
export interface PlayCandidate {
  word: string;
  verdict: Verdict;
}

export interface SyntheticPlay {
  /** Every word, in the order given, with what the game did with it. */
  submissions: SubmissionResult[];
  /** Every attempted rhyme the game did not count as an Answer. */
  candidates: PlayCandidate[];
  score: number;
  maxScore: number;
  /** The share of the maximum Score reached: what Reachability is estimated from. */
  share: number;
  /** The Rank reached. */
  rank: string;
}

/** Rejections that were never a rhyme the game refused: a repeat, the Seed Word itself, a malformed entry. */
const NOT_ATTEMPTED: ReadonlySet<RejectionReason> = new Set(["already-submitted", "is-the-seed-word", "malformed"]);

/** Play a word list as one Session: every word submitted, in order, through `session.ts`. */
export function playWords(context: PuzzleContext, words: readonly string[]): SyntheticPlay {
  let state = emptyPlayState;
  const submissions: SubmissionResult[] = [];
  for (const word of words) {
    const next = applySubmission(context, state, word);
    state = next.state;
    if (next.result) submissions.push(next.result);
  }
  const candidates = submissions
    .filter((s) => s.verdict.outcome !== "answer" && !(s.verdict.outcome === "rejected" && NOT_ATTEMPTED.has(s.verdict.reason)))
    .map((s) => ({ word: s.word, verdict: s.verdict }));
  const reached = score(context, state);
  return {
    submissions,
    candidates,
    score: reached,
    maxScore: context.maxScore,
    share: context.maxScore ? reached / context.maxScore : 0,
    rank: rank(context, state).label,
  };
}
