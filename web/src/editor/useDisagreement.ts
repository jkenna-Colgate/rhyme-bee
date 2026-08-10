/**
 * The one click that records a disagreement: post the Candidate, remember that
 * it landed (#163).
 *
 * ## Why there is no read
 *
 * Every other hook on this screen fetches a state and then writes into it, but
 * there is nothing here to read. The supplement-candidate queue is
 * append-only, is judged offline, and — unlike `data/demotions.txt` or
 * `data/tier-overrides.csv` — has no effect whatsoever on the day the editor is
 * looking at. Recording a disagreement changes no Answer, no Bonus Word and no
 * figure, which is exactly what the ticket means by an observation *surviving*
 * rather than being *resolved*. So the endpoint keeps its single verb, `POST`,
 * and no `GET` is added to it.
 *
 * ## What `recorded` is, and what it is not
 *
 * It is the disagreements *this tab* has successfully posted, and it exists so
 * the button can stop offering the same click twice. It is deliberately **not**
 * a model of the queue's contents: the queue is not readable from here, a reload
 * empties this set, and two disagreements over one word are two records rather
 * than one. That is a weaker claim than the demoter's — which replaces its whole
 * state with the file's own after every write, so nothing is ever off the screen
 * that is not on the disk — and it is the strongest claim available without
 * giving a write-only endpoint a read it does not need. The cost of being wrong
 * is a duplicate line in a queue whose judge reads every line anyway, against
 * the demotion's cost of a name still being served.
 *
 * It is a set of `disagreementKey`s and not of words. A disagreement is a word
 * *against a Seed Word*, and keying on the word alone made the second one
 * unrecordable: meet `bluebeard` again on another day's Puzzle and the button
 * was already gone, replaced by a sentence naming the new Seed about a record
 * that had never been made against it. See `disagreement.ts` for the argument.
 *
 * `recording` stays a bare word, and that is not an inconsistency. It names the
 * one post in flight, which belongs to the click that started it and is over in
 * milliseconds; a batch's readout is aimed at exactly one Seed Word, so within
 * the list the button is drawn in there is nothing for a word to be ambiguous
 * against. `recorded` is the one that accumulates across days, which is where
 * the ambiguity lives.
 *
 * ## Why a failure is loud, and says nothing was recorded
 *
 * The whole value of the button is that an observation made at 11pm survives to
 * a judging pass. A post that silently failed would leave the editor believing
 * it had, which is the one failure worth being noisy about — the same reason the
 * demoter is. `endpointFailure` already says "Nothing was written", which is
 * true here: `candidateFromReport` refuses a report whole, so there is nothing
 * partial to land.
 *
 * The failure carries the Seed Word it was about for the same reason the key
 * pairs on one. Held as a bare sentence it outlived what it described — a post
 * that failed on one day's Puzzle left its banner standing over the next day's
 * readout, telling the editor nothing was recorded about words they had not
 * tried to record. `failureFor` is where that is decided, at the render, and it
 * is a function rather than an effect so a test can reach it.
 *
 * ## Why nothing the editor reads calls this an Appeal
 *
 * The two sentences a failure can produce name the **supplement-candidate**
 * endpoint, which is what the path is and what the queue is called. `Appeal` is
 * pinned to a player's report about a Submission the game rejected (CONTEXT.md);
 * the editor's typed word is an *add*, adjudicated against nothing, so telling
 * them "the Appeal endpoint answered 400" would hand them a word for an act
 * they did not perform. `APPEAL_PATH` keeps the player's name because the path
 * was built for the player's act — that is argued at the constant itself.
 */

import { useCallback, useState } from "react";
import { APPEAL_PATH } from "../endpoints.ts";
import { disagreementKey, type DisagreementFailure, type DisagreementReport } from "./disagreement.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";

/**
 * What the editor is shown this endpoint is called. The URL's own last segment,
 * so a failed post can be traced from the sentence to the route without a
 * glossary in between.
 */
const ENDPOINT_NAME = "supplement-candidate";

export interface Disagreer {
  /** The word being written, so the button that was clicked can say so. */
  recording: string | null;
  /**
   * The disagreements this tab has recorded, by `disagreementKey`, so the button
   * stops offering a second click on the one that landed — and keeps offering it
   * on the same word against a different Seed Word.
   */
  recorded: ReadonlySet<string>;
  /** A post the endpoint refused, or one that never reached it, and its Seed Word. */
  failure: DisagreementFailure | null;
  /** Record one disagreement. Resolves once the queue has it. */
  record: (report: DisagreementReport) => Promise<void>;
}

export function useDisagreement(): Disagreer {
  const [recording, setRecording] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<DisagreementFailure | null>(null);

  const record = useCallback(async (report: DisagreementReport) => {
    setRecording(report.word);
    setFailure(null);
    try {
      const response = await fetch(APPEAL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      // The supplement-candidate endpoint refuses in the same `{ error }` shape
      // the editor's own routes do, from `candidateFromReport`'s sentence — so
      // the shared reader applies unchanged.
      const outcome = await readEndpointResponse<{ word: string }>(response, ENDPOINT_NAME);
      if (!outcome.ok) {
        setFailure({ message: outcome.error, seedWord: report.seedWord });
        return;
      }
      // Keyed on the endpoint's echo rather than on what was sent: the
      // validator normalises the word, and the button must say "recorded" about
      // the word that actually landed. The Seed Word is taken from the report,
      // which is the only place it exists — the endpoint echoes the word alone.
      setRecorded((held) =>
        new Set(held).add(disagreementKey(outcome.body.word, report.seedWord)),
      );
    } catch (cause) {
      setFailure({ message: endpointFailure(cause, ENDPOINT_NAME), seedWord: report.seedWord });
    } finally {
      setRecording(null);
    }
  }, []);

  return { recording, recorded, failure, record };
}
