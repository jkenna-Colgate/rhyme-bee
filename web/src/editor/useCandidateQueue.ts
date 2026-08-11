/**
 * The Candidate Queue's data layer: one fetch of the whole readout, states
 * already resolved (#177).
 *
 * ## Why it is not keyed to the day
 *
 * The queue is grouped by Rhyme Key and 17 of the 33 standing Candidates belong
 * to no scheduled day at all, so there is no date to fetch it for. It is fetched
 * once, like the demote gesture and unlike the Tier picker, and the day panel
 * selects out of it in the browser (`dayCandidates.ts`) rather than asking again
 * with a date on the request.
 *
 * ## Why it is refetched at all, when this slice writes nothing
 *
 * Because *everything else* writes. A Candidate's state is derived from
 * `data/` on every read, so an add landing in the supplement, a demotion landing
 * in the demotion list or a Tier verdict landing in the overrides can each
 * retire a Candidate — and a queue held from mount would go on presenting work
 * the editor has just done. `refresh` is what `EditorApp` calls after a write,
 * on the same observation it already makes for the status panel.
 *
 * ## Why a failure is quiet
 *
 * A queue that will not load leaves the panel saying so and changes nothing
 * else. The day, its figures and every gesture on it are unaffected: this is a
 * read of a scratch file that is pulled from R2 by hand, and a pass whose day
 * view broke because nobody had run `npm run pull:appeals` would have the
 * priority exactly backwards.
 */

import { useCallback, useEffect, useState } from "react";
import type { CandidateQueueReadout } from "../../../scripts/editorCandidates.ts";
import { EDITOR_CANDIDATES_PATH } from "../endpoints.ts";
import { readEndpointResponse } from "./fetchError.ts";

export interface CandidateQueueState {
  queue: CandidateQueueReadout | null;
  /** A request that produced no queue. The panel says so; nothing else stops. */
  error: string | null;
  loading: boolean;
  /** Ask again. Called after every write the tool makes. */
  refresh: () => void;
}

export function useCandidateQueue(): CandidateQueueState {
  const [queue, setQueue] = useState<CandidateQueueReadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped rather than set, for `useEditorStatus`'s reason: two writes in a row
  // must produce two reads, and a boolean would collapse them into one.
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((n) => n + 1), []);

  useEffect(() => {
    // A reply for a question already superseded must not land: reading the
    // pinned sources takes a moment, and the editor can make two writes inside
    // one of them.
    let current = true;
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(EDITOR_CANDIDATES_PATH);
        const result = await readEndpointResponse<CandidateQueueReadout>(response, "Candidate Queue");
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setQueue(result.body);
      } catch (cause) {
        // Deliberately not `endpointFailure`, whose sentence ends "Nothing was
        // written." Nothing is ever written from this route, so the reassurance
        // would be answering a question nobody asked.
        if (!current) return;
        setError(
          cause instanceof Error
            ? `${cause.message} — is the dev server still running?`
            : "The Candidate Queue endpoint could not be reached.",
        );
      } finally {
        if (current) setLoading(false);
      }
    })();

    return () => {
      current = false;
    };
  }, [asked]);

  return { queue, error, loading, refresh };
}
