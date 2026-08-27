/**
 * The day with the demoted words taken out of it, and the figures re-measured
 * off what is left.
 *
 * ## Why a demotion is not a Tier verdict
 *
 * A Tier verdict moves a word between the two lists. A demotion takes its
 * **wordhood**, so it leaves *both*: the Puzzle stops containing the word at
 * all, and a player who submits it is rejected rather than served an accepted,
 * celebrated Bonus Word. No verdict can express that — setting a name's
 * prevalence to the Bonus sentinel leaves its wordhood intact — which is why
 * `data/demotions.txt` is a second file and this is a second module rather than
 * a fifth button on the Tier picker's menu.
 *
 * ## Why the browser recomputes at all
 *
 * The same reason `retier.ts` gives: an entry is appended to
 * `data/demotions.txt` the instant it is clicked, but only reaches the index at
 * the next `npm run build:index`. Between those two moments the artifact is
 * stale by exactly the corrections the editor has just made, and a day that kept
 * showing a demoted name in its Answers would be a screen with no feedback in
 * it.
 *
 * ## Why that does not reintroduce a second opinion
 *
 * Nothing here restates the engine's arithmetic. The words are dropped by name,
 * and the three figures come from `measureAnswers` — the engine's own — called
 * over the shortened list, which is why `DayWord extends Scorable` (#155). The
 * Answer count, the maximum Score and the Difficulty are then whatever the
 * engine makes of the day that is left, including the case that surprises:
 * demoting a **Bonus Word** moves none of them, because the figures are measured
 * over the Answers alone.
 *
 * `web/__tests__/demote.test.ts` holds that claim to account the way the Tier
 * picker's is held: every case builds the fixture index a second time with the
 * demotion under test in `data/demotions.txt`'s own format, and asserts that a
 * rebuild lands where this module said it would.
 */

import { measureAnswers } from "../../../src/curation.ts";
import type { Demotion, DemotionReason } from "../../../src/demotions.ts";
import type { PuzzleFacts } from "../../../src/schedule.ts";
import type { DayLists } from "./retier.ts";

/** Everything the demote gesture needs that the day readout does not carry. */
export interface DemotionState {
  /**
   * Every entry in `data/demotions.txt`, not the day's slice of it. The file is
   * a couple of hundred entries at the outside and a day's readout is already
   * larger, and the whole list is what lets the screen answer "is this word
   * already demoted" without asking again per word.
   */
  standing: Demotion[];
}

/**
 * What the endpoint answers an accepted demotion with.
 *
 * Declared here rather than beside the endpoint that builds it, because the
 * browser cannot import that module — it opens files — and two declarations of
 * one wire shape is exactly the pair that drifts.
 */
export interface DemotionWriteResult {
  /** The file's own state, re-read after the entry landed. */
  state: DemotionState;
  /** The entry as written, shown rather than described. */
  appended: Demotion;
}

/**
 * The two demote buttons' text, and what each promises.
 *
 * Every key `DEMOTION_REASONS` names is required here — miss one and this object
 * literal fails to compile, so a reason added to the type cannot become a button
 * with no text. The labels name the rejection rather than the file's spelling,
 * because that is what the editor is choosing: the second column of
 * `data/demotions.txt` is the message the player receives.
 *
 * Here rather than in a view because the gesture is now raised from two panels —
 * a word's verdict menu on the day, and the pasted list's names-and-non-words
 * pile (#191) — and one file's one column is worth one wording. Two copies would
 * drift, and what drifted would be the sentence a player is told. It sits beside
 * `showsDemotionReassurance` for the same reason that predicate does: it is a
 * rule about the demote gesture, and a view is where it is rendered rather than
 * where it is decided.
 */
export const DEMOTION_LABEL: Record<DemotionReason, string> = {
  "proper-noun": "It’s a name",
  "not-a-known-word": "It’s not a word",
};

/** What each button promises, spelled out on hover. */
export const DEMOTION_TITLE: Record<DemotionReason, string> = {
  "proper-noun": "Rejected as a Proper Noun — the player is told it is a name",
  "not-a-known-word": "Rejected as not a known word — no claim that it is anybody’s name",
};

/** The demoted words, by name — all a day needs of the standing list. */
export function demotedWords(standing: readonly Demotion[]): ReadonlySet<string> {
  return new Set(standing.map((entry) => entry.word));
}

/**
 * Whether the write-failed banner's stock reassurance belongs after a refused
 * demotion.
 *
 * A 409 already carries its own complete sentence from the endpoint — "kate is
 * already demoted, as proper-noun. Reversing a demotion is a hand edit of
 * data/demotions.txt." — because the word named already has no wordhood.
 * Appending the banner's usual "Nothing was demoted — the word is still a
 * word" there would assert the opposite of what the endpoint's own sentence
 * just said. Every other refusal (400/413/500) never touched the file, so the
 * reassurance is true for those and stays.
 */
export function showsDemotionReassurance(alreadyDemoted: boolean): boolean {
  return !alreadyDemoted;
}

/** A day's two lists and its three figures, as one thing. */
export interface ShownDay {
  lists: DayLists;
  facts: PuzzleFacts;
}

/**
 * The day without its demoted words, and the figures that go with it.
 *
 * A day holding none of them is returned **untouched**, figures and all, rather
 * than re-measured to the same numbers. That is deliberate: it keeps
 * `DayReadoutView`'s claim that every figure on it is either read straight off
 * the readout Node computed or moved by a correction the editor has just made.
 * Re-measuring a day nobody has corrected would make the screen's figures its
 * own, for no gain — the arithmetic would agree, and the provenance would not.
 */
export function withoutDemoted(
  lists: DayLists,
  facts: PuzzleFacts,
  demoted: ReadonlySet<string>,
): ShownDay {
  if (demoted.size === 0) return { lists, facts };

  const keep = (list: DayLists["answers"]) => list.filter((entry) => !demoted.has(entry.word));
  const answers = keep(lists.answers);
  const bonusWords = keep(lists.bonusWords);
  if (answers.length === lists.answers.length && bonusWords.length === lists.bonusWords.length) {
    return { lists, facts };
  }

  return { lists: { answers, bonusWords }, facts: measureAnswers(answers) };
}
