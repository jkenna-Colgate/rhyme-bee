/**
 * What the Judge left, in the editor's terms (#269): the sentence beside a
 * Candidate it ruled on, and the proposal a Confirm approves.
 *
 * The record is the one the landing step writes (`src/judgeLanding.ts`, #266),
 * read server-side onto the Candidate Queue readout. Nothing here decides
 * anything: the Judge *judged*, and the screen is where the editor *rules*, so
 * these sentences say what the Judge did and never what the editor should.
 *
 * The sentences are tables over closed unions, for `STATE_SENTENCE`'s reason:
 * a new way a ruling can land cannot be added without them refusing to compile.
 */

import type { ReadUnconfirmedRhyme } from "../../../scripts/editorCandidates.ts";
import type { JudgeRulingRecord, Landed } from "../../../src/judgeLanding.ts";
import type { WhatTheGameKnew } from "../../../src/judge.ts";
import { respell } from "../../../src/respelling.ts";
import type { CorrectionProposal } from "./correction.ts";

/** What the game knew, which is what a ruling is named for. */
export const KNEW_SENTENCE: Record<WhatTheGameKnew, string> = {
  "missing-reading": "a Missing Reading: the game held no reading for the word",
  overrule: "an Overrule: the game's reading misses this Rhyme Key",
};

/** What the ruling wrote, and so what is left for the editor. */
export const LANDED_SENTENCE: Record<Landed, string> = {
  reading: "It wrote the reading, so the word rhymes on this key by itself.",
  "unconfirmed-rhyme": "It listed an Unconfirmed Rhyme: accepted on this key without Points until you confirm or Decline it.",
  "suggested-demotion": "It wrote nothing, and suggests a Demotion.",
  nothing: "It wrote nothing, and the Candidate waits for your ruling.",
};

const WORDHOOD_SENTENCE: Record<NonNullable<JudgeRulingRecord["wordhood"]>["verdict"], string> = {
  word: "a word",
  name: "a name",
  "not-a-word": "not a word",
};

/**
 * The Judge's ruling as a few plain sentences: what it heard, how sure it was,
 * what the game knew, and what landed. Its own one-sentence reason is shown
 * apart, as written.
 */
export function judgeRulingSentence(r: JudgeRulingRecord): string {
  const heard = r.verdict === "rhyme"
    ? `judged it a Rhyme${r.reading ? `, hearing ${r.reading}` : ""}`
    : "judged it no Rhyme";
  const wordhood = r.wordhood
    ? ` Asked whether it is a word, it said ${WORDHOOD_SENTENCE[r.wordhood.verdict]} (${r.wordhood.confidence} confidence).`
    : "";
  const landed = r.heldBack === "scheduled-seed-word"
    ? "It wrote nothing: the word is a scheduled Seed Word, which is never an Unconfirmed Rhyme."
    : LANDED_SENTENCE[r.landed];
  return `The Judge (${r.model}, ${r.date}) ${heard} at ${r.confidence} confidence, on ${KNEW_SENTENCE[r.knew]}.${wordhood} ${landed}`;
}

/**
 * How an Unconfirmed Rhyme is confirmed, which depends on what there is to
 * confirm it with:
 *
 * - **approve**: the Judge's reading is in hand, so the Confirm is the
 *   correction gesture offered it as a standing proposal (`confirmProposal`).
 * - **ask**: there is no proposal, and the engine holds a reading of its own
 *   that misses the key (an Overrule). Asking an agent for a correction is the
 *   correction route's own case, and it answers.
 * - **add**: there is no proposal and the engine holds no reading at all (a
 *   Missing Reading). The correction route answers `nothing-to-correct` for a
 *   word with no reading without asking anyone (`proposeCorrection`), so an
 *   ask there would leave the line with no way to be confirmed. What a word
 *   with no reading wants is an add, aimed at the line's Rhyme Key: the add
 *   path asks its agent for a reading on that key and writes it, after which
 *   the word rhymes by itself and the line is stale.
 */
export type ConfirmGesture = "approve" | "ask" | "add";

/** Which of the three a line offers. Pure, so the choice is tested away from the card. */
export function confirmGesture(u: ReadUnconfirmedRhyme): ConfirmGesture {
  if (u.proposal !== null) return "approve";
  return u.readings.length > 0 ? "ask" : "add";
}

/**
 * The proposal a Confirm approves: the Judge's reading beside the engine's own,
 * through the correction route like any other reading (ADR-0017 amended). Null
 * when there is no reading to confirm, and the editor asks an agent or queues
 * an add instead (`confirmGesture`).
 */
export function confirmProposal(u: ReadUnconfirmedRhyme): CorrectionProposal | null {
  if (u.proposal === null) return null;
  return {
    outcome: "proposed",
    word: u.line.word,
    target: u.line.rhymeKey,
    current: u.readings,
    phonemes: u.proposal.phonemes,
    key: u.proposal.key,
    respelling: respell(u.proposal.phonemes),
    reaches: u.proposal.reaches,
  };
}
