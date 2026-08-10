/**
 * Recording the editor's disagreement with a reading the index already holds
 * (#163).
 *
 * ## What the disagreement is
 *
 * A word the editor typed as missing turns out to be in the index already — on
 * a Rhyme Key that is not this day's. The engine has a pronunciation for it, and
 * that pronunciation says it does not rhyme. `scripts/editorAdd.ts` calls that
 * `reads-on-another-key` and writes nothing, because overriding an upstream
 * pronunciation is a hand edit of `data/supplement.dict` and never something a
 * program does on its own judgement. The editor, reading a third-party rhyme
 * list in the next window, believes the word rhymes anyway.
 *
 * That belief is the whole of what this module carries, and it carries it as a
 * **Candidate**: the report, never the fix (CONTEXT.md). Nothing here proposes a
 * reading, and no pronunciation correction is offered anywhere in this flow.
 * Contradicting a source that spoke is a different act from filling a gap where
 * the sources are silent, with different stakes and its own evidence
 * requirements, and it is settled offline against the queue rather than at
 * 11pm from a browser.
 *
 * ## Why the queue is the one built for Appeals
 *
 * `src/supplementCandidate.ts` already holds exactly this record — the word, the
 * Seed Word, the Seed's Rhyme Key, a `does-not-rhyme` reason, the engine's
 * respelling and a timestamp — and `web/supplementPlugin.ts` already serves it.
 * The judge's question is identical whichever end it arrives from: *the engine
 * reads this word this way and somebody says it rhymes anyway — who is right?*
 * A second queue with the same six fields would be a second thing to pull down,
 * a second thing to judge, and a second place for one of them to be forgotten.
 *
 * The two ends are not the same **act**, and the record does not pretend they
 * are. A player's Appeal contests a verdict delivered against their Submission
 * mid-play; the editor's word is an *add*, typed in a pass before the date, and
 * nothing was adjudicated against them. What both produce is the same claim
 * about the same reading, which is why one record fits and why `word` is filled
 * from the add rather than from any Submission.
 *
 * ## Why the timestamp is not here
 *
 * A report carries five fields and the endpoint stamps the sixth. That is the
 * existing rule and not a shortcut: `candidateFromReport` refuses a report
 * carrying a field it does not recognise, and takes the instant from the caller
 * rather than the sender precisely so nothing on the far end of a socket can
 * scatter records across the queue's ordering. The editor's browser is no more
 * entitled to name the instant than a player's is.
 */

import type { RhymeKey } from "../../../src/phonology.ts";
import { respell } from "../../../src/respelling.ts";
import type { ReadingEvidence } from "../../../src/supplementEvidence.ts";

/**
 * The body posted to the Appeal endpoint: a Candidate less the timestamp the
 * endpoint stamps it with.
 *
 * Its five fields are exactly `REPORT_FIELDS` in `src/supplementCandidate.ts`,
 * and the type is written out here rather than derived from `SupplementCandidate`
 * with an `Omit` so that adding a seventh field to the record does not silently
 * become a sixth field on this wire. A report the endpoint does not recognise is
 * refused whole, so the two lists have to be kept in step deliberately.
 */
export interface DisagreementReport {
  word: string;
  seedWord: string;
  seedRhymeKey: string;
  /**
   * Always `does-not-rhyme`, and a literal rather than a `RejectionReason`: it
   * is the only reason this case can produce. The word has a reading (so it is
   * not `not-a-known-word`), it is not a name (`resolveAddOutcome` refuses those
   * before it ever reaches this outcome), and nothing was submitted against a
   * Puzzle, which rules out the rest of the closed set.
   */
  reason: "does-not-rhyme";
  engineRespelling: string | null;
}

/**
 * The disagreement over one word, ready to post.
 *
 * `engineRespelling` is the respelling of the **first** reading, which is not an
 * arbitrary pick: `RhymeIndex.adjudicate` builds its own `does-not-rhyme`
 * verdict from `prons[0]` and respells that, and `gatherEvidence` maps the same
 * pronunciation list in the same order under the same Normalisation. So the
 * respelling recorded here is the one the engine itself would have shown a
 * player who submitted this word against this Seed — the reading the judge has
 * to agree or disagree with. `web/__tests__/disagreement.test.ts` holds the two
 * against each other rather than restating the convention.
 *
 * A word with several readings therefore records one respelling while the screen
 * names every key the index holds it on. That asymmetry is deliberate: the
 * record's field is singular and is defined as *the reading the engine used*, so
 * joining the readings into it would put a string in the queue that no reading
 * is — and `RESPELLING_SHAPE` would refuse it in any case. The screen is where
 * "and it also reads this other way" belongs, because the editor is the one who
 * can act on it.
 *
 * Null readings return a null respelling rather than throwing. A
 * `reads-on-another-key` outcome always carries at least one — it is produced
 * only when `evidence.direct` is non-empty — so this is the empty case being
 * given an answer, not a case that happens.
 */
export function disagreementReport(
  word: string,
  readings: readonly ReadingEvidence[],
  seedWord: string,
  seedRhymeKey: RhymeKey,
): DisagreementReport {
  const used = readings[0];
  return {
    word,
    seedWord,
    seedRhymeKey,
    reason: "does-not-rhyme",
    engineRespelling: used ? respell(used.phonemes) : null,
  };
}

/**
 * What makes one disagreement distinct from another: the word **and the Seed
 * Word**, never the word alone.
 *
 * The same word is a different observation against a different Seed. `bluebeard`
 * recorded on the `beard` day and `bluebeard` met again on some later `bust` day
 * are two claims about two Puzzles, and the judge rules on them separately — the
 * reading the engine holds is the same, and whether *that* reading rhymes is a
 * different question each time it is asked against a different key. Keyed on the
 * word alone, the second one could not be recorded at all: the button would
 * already be gone, replaced by a sentence naming the new Seed Word about a
 * record that was never made against it — a screen misdescribing the queue, on
 * the one gesture whose entire purpose is that an observation survives.
 *
 * A space separates the two because neither can contain one. Both ends of the
 * pair are `^[a-z]+$`: the word comes back from the endpoint, which refuses
 * anything else (`SUBMISSION_SHAPE`, `src/supplementCandidate.ts`), and the Seed
 * Word comes out of `data/schedule.json` already in that shape. So no two pairs
 * can collide by running into each other.
 */
export function disagreementKey(word: string, seedWord: string): string {
  return `${word} ${seedWord}`;
}

/**
 * A post the endpoint refused or never received, and the Seed Word it was about.
 *
 * The Seed is carried for the same reason the key above pairs on it: a failure
 * is about one disagreement, and a disagreement is a word against a Seed Word.
 * Without it the sentence outlived what it was about — record on the `beard`
 * day, fail, submit a batch on some other day, and the banner was still standing
 * over a readout it had nothing to do with, telling the editor that nothing was
 * recorded about words they had not tried to record.
 */
export interface DisagreementFailure {
  message: string;
  seedWord: string;
}

/**
 * The failure sentence to show over a readout aimed at `seedWord`, or `null`
 * when the standing failure is about some other Puzzle.
 *
 * Pure and read at the render rather than cleared by an effect on the day
 * changing, which was the other option. An effect would have needed the hook to
 * be told the date — a second thing for it to know, and the wrong one, since a
 * date change is not what makes the sentence stale: it goes stale when the
 * readout under it is replaced by one about a different Seed Word, which is what
 * this compares. It is also the half of the rule a test can reach, `web/` having
 * no way to render a hook.
 */
export function failureFor(
  failure: DisagreementFailure | null,
  seedWord: string | null,
): string | null {
  if (failure === null || seedWord === null) return null;
  return failure.seedWord === seedWord ? failure.message : null;
}
