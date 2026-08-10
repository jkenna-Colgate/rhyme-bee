/**
 * Asking Node for a day. The whole of the editor screen's data layer, and the
 * whole of what it knows about a day: a `DayReadout`, computed by the same
 * `readScheduledDay` the terminal renderer calls, fetched rather than derived.
 *
 * The three cases of the readout are **not** errors and are not handled here —
 * a date outside the run and a Seed the index cannot pin are both answers, and
 * arrive as a 200 carrying the case for the view to render. What this reports as
 * an error is a request that did not produce a readout at all: an unreachable
 * dev server, or a 500 saying no index has been built.
 *
 * There is no date in the initial request, because *which* day the screen opens
 * on is a decision the endpoint makes (tomorrow) rather than one the browser
 * makes and then displays on its own authority. The readout names its own date,
 * and that is what the date control is set from.
 */

import { useCallback, useEffect, useState } from "react";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { EDITOR_DAY_PATH } from "../endpoints.ts";
import { readEndpointResponse } from "./fetchError.ts";

export interface DayReadoutState {
  readout: DayReadout | null;
  /** True until the first readout arrives, and again for every jump after it. */
  loading: boolean;
  /** A request that produced no readout. Never one of the readout's own cases. */
  error: string | null;
  /** Jump to a day. `null` asks the endpoint for the day it opens on. */
  goTo: (date: string | null) => void;
  /**
   * Put a readout some other request produced on screen. Submit's is the one:
   * it re-reads the day from the index it has just rebuilt and answers with it
   * in the same response, so the fresh day arrives here rather than through a
   * second `GET` that would leave a window showing the day from before the pass.
   *
   * It does not move the day the screen is *on* — the readout names the date it
   * was built for, and Submit only ever builds the day already open — so no
   * fetch is triggered and the date control does not flicker.
   */
  show: (readout: DayReadout) => void;
}

export function useDayReadout(): DayReadoutState {
  const [date, setDate] = useState<string | null>(null);
  const [readout, setReadout] = useState<DayReadout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // An in-flight request whose day is no longer the one asked for must not
    // land: the editor can retype a date faster than a day is built, and the
    // screen showing whichever reply happened to be slower is a bug that only
    // appears under exactly the impatience this tool invites.
    let current = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const url = date === null ? EDITOR_DAY_PATH : `${EDITOR_DAY_PATH}?date=${date}`;
        const response = await fetch(url);
        const result = await readEndpointResponse<DayReadout>(response, "day");
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setReadout(result.body);
      } catch (cause) {
        if (!current) return;
        setError(
          cause instanceof Error
            ? `${cause.message} — is the dev server still running?`
            : "The day endpoint could not be reached.",
        );
      } finally {
        if (current) setLoading(false);
      }
    })();

    return () => {
      current = false;
    };
  }, [date]);

  const goTo = useCallback((next: string | null) => setDate(next), []);
  const show = useCallback((next: DayReadout) => setReadout(next), []);
  return { readout, loading, error, goTo, show };
}
