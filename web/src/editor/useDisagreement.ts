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
 * It is the words *this tab* has successfully posted, and it exists so the
 * button can stop offering the same click twice. It is deliberately **not** a
 * model of the queue's contents: the queue is not readable from here, a reload
 * empties this set, and two disagreements over one word are two records rather
 * than one. That is a weaker claim than the demoter's — which replaces its whole
 * state with the file's own after every write, so nothing is ever off the screen
 * that is not on the disk — and it is the strongest claim available without
 * giving a write-only endpoint a read it does not need. The cost of being wrong
 * is a duplicate line in a queue whose judge reads every line anyway, against
 * the demotion's cost of a name still being served.
 *
 * ## Why a failure is loud, and says nothing was recorded
 *
 * The whole value of the button is that an observation made at 11pm survives to
 * a judging pass. A post that silently failed would leave the editor believing
 * it had, which is the one failure worth being noisy about — the same reason the
 * demoter is. `endpointFailure` already says "Nothing was written", which is
 * true here: `candidateFromReport` refuses a report whole, so there is nothing
 * partial to land.
 */

import { useCallback, useState } from "react";
import { APPEAL_PATH } from "../endpoints.ts";
import type { DisagreementReport } from "./disagreement.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";

export interface Disagreer {
  /** The word being written, so the button that was clicked can say so. */
  recording: string | null;
  /** Words this tab has recorded, so the button stops offering a second click. */
  recorded: ReadonlySet<string>;
  /** A post the endpoint refused, or one that never reached it. */
  error: string | null;
  /** Record one disagreement. Resolves once the queue has it. */
  record: (report: DisagreementReport) => Promise<void>;
}

export function useDisagreement(): Disagreer {
  const [recording, setRecording] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const record = useCallback(async (report: DisagreementReport) => {
    setRecording(report.word);
    setError(null);
    try {
      const response = await fetch(APPEAL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      // The Appeal endpoint refuses in the same `{ error }` shape the editor's
      // own routes do, from `candidateFromReport`'s sentence — so the shared
      // reader applies unchanged.
      const outcome = await readEndpointResponse<{ word: string }>(response, "Appeal");
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      // Keyed on the endpoint's echo rather than on what was sent: the
      // validator normalises the word, and the button must say "recorded" about
      // the word that actually landed.
      setRecorded((held) => new Set(held).add(outcome.body.word));
    } catch (cause) {
      setError(endpointFailure(cause, "Appeal"));
    } finally {
      setRecording(null);
    }
  }, []);

  return { recording, recorded, error, record };
}
