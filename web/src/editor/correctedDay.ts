/**
 * The day as the next rebuild will produce it: every standing Tier verdict and
 * demotion applied to the readout, with the figures re-measured.
 *
 * ## Why the composition is a module rather than a render body
 *
 * `retier.ts` and `demote.ts` each answer one correction, and each is held
 * against a genuine rebuild by its own test. What neither of them owns is how
 * the two go *together* — which one runs first, whose state is allowed to apply
 * to this day at all, and what counts as the day having moved. Those rules sat
 * between `DayReadoutView`'s props and its JSX, where no test in this repo could
 * reach them: there is no DOM environment, by choice. Every one of them is a
 * line away from being silently wrong, and silence is the point — a day rendered
 * with yesterday's verdicts on it looks exactly like a day rendered correctly.
 *
 * ## Why demotions come out before anything is re-tiered
 *
 * A demotion withdraws **wordhood**; a verdict moves a word between the two
 * lists. Re-tiering a demoted word is therefore asking which Tier a non-word
 * is — a question with no answer, whose only effect would be to put the word
 * back on a screen the editor has just taken it off. Both halves are tested
 * apart; this order is what makes them a pass.
 *
 * ## Why a picker state can belong to another day
 *
 * `useTierPicker` refetches when the date changes and drops a *superseded
 * reply*, but it never clears `state` in the meantime. Between a new date being
 * typed and its fetch landing, `picker.state` still holds the previous day's
 * verdicts — over the new day's words, which is Monday's judgements applied to
 * Tuesday. The date guard here is the one thing that rules it out. Demotions
 * need no such guard: they name words and no date, so the standing list is the
 * same list on every day the editor visits.
 */

import type { ScheduledDayReadout, DayWord } from "../../../scripts/editorDay.ts";
import type { PuzzleFacts } from "../../../src/schedule.ts";
import { demotedWords, withoutDemoted, type DemotionState } from "./demote.ts";
import { retierDay, type RetieredDay, type RetieredWord, type TierPickerState } from "./retier.ts";

export interface CorrectedDay extends RetieredDay {
  /**
   * Whether corrections have moved this day's figures since the artifact was
   * built. The band verdicts the readout carries were decided against the
   * figures as built, so this is also what makes them stale — a day that has
   * moved has its band verdicts withdrawn rather than restated over numbers
   * they were never about.
   */
  moved: boolean;
}

/**
 * The corrected day, and whether correcting it moved it.
 *
 * Takes plain data rather than the three hooks the view holds, so what it does
 * with a null state, a foreign date or an empty demotion list is a thing a test
 * can ask about with an object literal.
 */
export function correctedDay(
  readout: ScheduledDayReadout,
  picking: TierPickerState | null,
  demotions: DemotionState | null,
): CorrectedDay {
  // A state fetched for another day must not be applied to this one — the two
  // requests are independent and either can land first.
  const verdicts = picking?.date === readout.date ? picking : null;

  const day = withoutDemoted(
    { answers: readout.answers, bonusWords: readout.bonusWords },
    readout.facts,
    demotedWords(demotions?.standing ?? []),
  );

  const corrected =
    verdicts === null
      ? {
          answers: day.lists.answers.map(unjudged),
          bonusWords: day.lists.bonusWords.map(unjudged),
          facts: day.facts,
        }
      : retierDay(day.lists, verdicts);

  return { ...corrected, moved: !sameFigures(corrected.facts, readout.facts) };
}

/** A day with no picker state yet: the readout's own words, judged by nobody. */
function unjudged(entry: DayWord): RetieredWord {
  return { ...entry, verdict: null, rows: 0, source: null, sourceVerdict: null };
}

/**
 * `difficulty` is compared with `===` on purpose, and an epsilon here would be
 * a magic constant guarding a case that cannot arise. The equality is exact by
 * construction: Difficulty is `rareMass / maxScore`, both sums of `scoreEntry`
 * points — a length plus a flat rare bonus, so integer sums — and identical
 * integer pairs give a bit-identical quotient. A day nothing was removed from
 * is returned untouched by `withoutDemoted` rather than re-measured, and
 * `retierDay` preserves list order when no word changes Tier, so even the
 * re-measured path sums in the same order. A tolerance would weaken a check
 * that is currently exact; what this rule needs is a test, and it has one.
 */
function sameFigures(a: PuzzleFacts, b: PuzzleFacts): boolean {
  return a.answerCount === b.answerCount && a.maxScore === b.maxScore && a.difficulty === b.difficulty;
}
