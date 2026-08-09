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
