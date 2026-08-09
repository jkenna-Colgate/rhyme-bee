/**
 * The status readout's data layer: two facts about the repository, refetched
 * when either of them can have changed (#162).
 *
 * ## Why it is fetched at all, rather than inferred
 *
 * The browser could work out most of this for itself. It knows it just recorded
 * a Tier verdict, so it knows the index is now stale; it knows Submit rebuilt,
 * so it knows the index is now current. Every one of those inferences is a
 * second model of the disk, and the moment one disagrees the screen is stating
 * something about the maintainer's repository on its own authority. That is the
 * position the Tier picker and the demote gesture already take — *nothing is
 * ever on the screen that is not on the disk* — and this panel exists precisely
 * to be believed, so it takes it too.
 *
 * ## When it is refetched, and why there is no poll
 *
 * Three moments, and they are the three in which either fact can move.
 *
 * **On mount**, because the editor arrives mid-story: last night's pass may be
 * on disk uncommitted, and the whole point of the panel is that this is
 * something to look at rather than remember.
 *
 * **After every write the tool makes** — a Tier verdict, a demotion, a Submit.
 * Those are the only acts that change the index's staleness, and the widened
 * Submit rule depends on it: a verdict that did not refresh the status would
 * leave Submit disabled with the work sitting on disk, which is the exact
 * failure #162 exists to end.
 *
 * **When the window regains focus**, which is the only one of the three the
 * browser cannot cause. The editor commits in a terminal and comes back; the
 * fact that changed happened outside the tab entirely. A poll would cover the
 * same case and was rejected: it spawns a `git` per interval for the whole
 * evening a pass is open, to catch an event that always coincides with the tab
 * being returned to. Focus is that event, exactly, and costs nothing while the
 * editor is reading a day.
 *
 * ## Why a failure is quiet
 *
 * A status that will not load leaves the panel saying so and changes nothing
 * else. It is advisory: no verdict, no add and no rebuild depends on it, and
 * the one rule that reads it (`pendingWork`) treats an absent status as "not
 * stale", which at worst leaves Submit disabled on an empty queue. A tool whose
 * day view broke because a git subprocess did would have the priority exactly
 * backwards.
 */

import { useCallback, useEffect, useState } from "react";
import { EDITOR_STATUS_PATH } from "../endpoints.ts";
import { readEndpointResponse } from "./fetchError.ts";
import type { EditorStatus } from "./status.ts";

export interface EditorStatusState {
  status: EditorStatus | null;
  /** A request that produced no status. The panel says so; nothing else stops. */
  error: string | null;
  /** Ask again. Called after every write the tool makes. */
  refresh: () => void;
}

export function useEditorStatus(): EditorStatusState {
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped rather than set: two writes in a row must produce two reads, and a
  // boolean or a timestamp would collapse them if they landed in one render.
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((n) => n + 1), []);

  useEffect(() => {
    // A reply for a question already superseded must not land: the editor can
    // click through several words faster than a `git status` returns, and the
    // panel showing whichever reply happened to be slower is a bug that only
    // appears under exactly the impatience this tool invites.
    let current = true;

    void (async () => {
      try {
        const response = await fetch(EDITOR_STATUS_PATH);
        const result = await readEndpointResponse<EditorStatus>(response, "status");
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setStatus(result.body);
      } catch (cause) {
        // Deliberately not `endpointFailure`, whose sentence ends "Nothing was
        // written." That reassurance is for the routes that write; here it
        // would be answering a question nobody asked, on the one route in the
        // pass that could not write if it tried.
        if (!current) return;
        setError(
          cause instanceof Error
            ? `${cause.message} — is the dev server still running?`
            : "The status endpoint could not be reached.",
        );
      }
    })();

    return () => {
      current = false;
    };
  }, [asked]);

  useEffect(() => {
    // `focus` rather than `visibilitychange`: the editor's other window is a
    // terminal or a rhyme list, not another tab, so the tab stays visible the
    // whole time it is not focused and `visibilitychange` would never fire.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return { status, error, refresh };
}
