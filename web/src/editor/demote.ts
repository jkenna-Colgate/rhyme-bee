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
import type { Demotion } from "../../../src/demotions.ts";
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

/** The demoted words, by name — all a day needs of the standing list. */
export function demotedWords(standing: readonly Demotion[]): ReadonlySet<string> {
  return new Set(standing.map((entry) => entry.word));
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
