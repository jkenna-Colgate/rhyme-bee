/**
 * The Tier picker's data layer: what the file says now, and the one call that
 * changes it.
 *
 * ## Why there is no local edit buffer
 *
 * `judge` does not move anything itself. It posts the verdict, waits for the
 * endpoint to append it, and replaces the whole state with the file's own
 * refreshed copy — which is what moves the word. That round trip is a few
 * milliseconds on localhost, and paying it buys the property ADR-0015 is built
 * around: **nothing is ever on the screen that is not on the disk**. An
 * optimistic local copy would be a second model of what has been decided, in a
 * tool whose entire output *is* the file, and the moment it disagreed — a failed
 * write, a permission error — the editor would be reading a judgement they had
 * not actually made.
 *
 * ## Why a failed write is loud
 *
 * A judgement that did not reach the file is a judgement that did not happen, so
 * a failure leaves the day exactly as it was and says so. This is the one place
 * in the pass where silence would cost work: the editor's next act is to click
 * the next word.
 *
 * The state is fetched per day, because the lemma walk and the measured values
 * in it are the day's. The standing verdicts are the whole file's, and are
 * therefore refetched on a day change too — which is right, since a judgement
 * made on one day's screen can govern a word on another's.
 */

import { useCallback, useEffect, useState } from "react";
import type { TierVerdict } from "../../../src/tierOverride.ts";
import { EDITOR_TIER_PATH } from "../endpoints.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";
import type { TierPickerState, TierWriteResult } from "./retier.ts";

export interface TierPicker {
  state: TierPickerState | null;
  /** A judgement in flight, so the word clicked can say it is being written. */
  writing: string | null;
  /** A request that produced no state, or a write the file refused. */
  error: string | null;
  /** The last judgement recorded, kept on screen until the next one or a day change. */
  recorded: TierWriteResult | null;
  /**
   * Record a verdict against the day on screen. Resolves once the file has it
   * and the state is refreshed.
   */
  judge: (word: string, verdict: TierVerdict) => Promise<void>;
}

export function useTierPicker(date: string | null): TierPicker {
  const [state, setState] = useState<TierPickerState | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<TierWriteResult | null>(null);

  useEffect(() => {
    if (date === null) return;
    // A reply for a day that is no longer on screen must not land: the editor
    // can retype a date faster than a day is read, and the picker showing one
    // day's verdicts over another day's words would be silently wrong.
    let current = true;
    setRecorded(null);

    void (async () => {
      try {
        const response = await fetch(`${EDITOR_TIER_PATH}?date=${date}`);
        const result = await readEndpointResponse<TierPickerState>(response, "Tier");
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setState(result.body);
      } catch (cause) {
        if (current) setError(endpointFailure(cause, "Tier"));
      }
    })();

    return () => {
      current = false;
    };
  }, [date]);

  const judge = useCallback(
    async (word: string, verdict: TierVerdict) => {
      // The day posted is the one the words on screen belong to, which is this
      // argument: `EditorApp` passes the readout's own date, and `DayReadoutView`
      // builds both lists from that same readout — so the words being judged and
      // this `date` move together, always. `state.date` does **not**: it lags
      // until the read lands, and while it lags `correctedDay` renders the
      // readout's words unjudged rather than holding them back, so a verdict
      // clicked in that window would be posted against the day the editor has
      // already left.
      //
      // What goes with the fallback this line used to carry is the day it fell
      // back to. An empty date is not refused by `editorDayRequest`: it reads as
      // none named and resolves to the day after today, so the readback came home
      // with another day's standing verdicts and reach over the words just
      // judged. (The row written was always right — `TierOverrideRow` has no date
      // field, because a Tier verdict is a property of the word.) A null date is
      // instead the case where there is no readout at all, and with no readout
      // there are no words and no button to have called this.
      if (date === null) return;
      setWriting(word);
      setError(null);
      try {
        const response = await fetch(`${EDITOR_TIER_PATH}?date=${date}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, verdict }),
        });
        const outcome = await readEndpointResponse<TierWriteResult>(response, "Tier");
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        const result = outcome.body;
        setRecorded(result);
        setState(result.state);
      } catch (cause) {
        setError(endpointFailure(cause, "Tier"));
      } finally {
        setWriting(null);
      }
    },
    [date],
  );

  return { state, writing, error, recorded, judge };
}
