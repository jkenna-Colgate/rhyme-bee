/**
 * The demote gesture's data layer: what `data/demotions.txt` says now, and the
 * one call that adds to it.
 *
 * ## Why there is no local edit buffer
 *
 * `demote` does not remove anything itself. It posts the word and the reason,
 * waits for the endpoint to append them, and replaces the whole state with the
 * file's own refreshed copy — which is what takes the word out of the day. That
 * round trip is a few milliseconds on localhost, and paying it buys the property
 * the Tier picker is built around too: **nothing is ever off the screen that is
 * not on the disk**. An optimistic local copy would be a second model of what
 * has been demoted, and the moment it disagreed — a failed write, a word the
 * file already held — the editor would believe they had removed a name that is
 * still being served.
 *
 * ## Why the state is fetched once and not per day
 *
 * A demotion takes a word's wordhood, which is a property of the word and of no
 * date, so the standing list is the same list on every day the editor visits.
 * The Tier picker refetches on a day change because the lemma walk and the
 * measured values in its state *are* the day's; there is nothing here that is.
 *
 * The *banner* is a different matter and does take the day, which is why the
 * hook is given one at all: `recorded` and `alreadyDemoted` report a write the
 * editor just made, and a write made on one day is not news on another.
 *
 * ## Why a failed write is loud
 *
 * A demotion that did not reach the file is a demotion that did not happen, and
 * the word is still being served as an ordinary Answer. That is the failure
 * worth being noisy about: the editor's next act is to click the next word, and
 * a silently dropped write would leave a name in tomorrow's Puzzle.
 *
 * ## Why a 409 carries its own flag
 *
 * `alreadyDemoted` is the one refusal `error` cannot be read back to distinguish
 * from the rest, and the view needs to: the endpoint's sentence on a 409 already
 * says the word has no wordhood ("kate is already demoted, as proper-noun"), so
 * appending the write-failed banner's usual reassurance — "the word is still a
 * word" — there would assert the opposite of what the sentence just said. Every
 * other refusal (400/413/500) never touched the file, so the reassurance is
 * true for those and `DayReadoutView` still shows it, gated on this flag.
 */

import { useCallback, useEffect, useState } from "react";
import type { Demotion, DemotionReason } from "../../../src/demotions.ts";
import { EDITOR_DEMOTION_PATH } from "../endpoints.ts";
import type { DemotionState, DemotionWriteResult } from "./demote.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";

export interface Demoter {
  state: DemotionState | null;
  /** A demotion in flight, so the word clicked can say it is being written. */
  writing: string | null;
  /** A request that produced no state, or a write the file refused. */
  error: string | null;
  /** True when `error` is the 409 the file sends for a word it already names. */
  alreadyDemoted: boolean;
  /** The last demotion recorded, kept on screen until the next one. */
  recorded: Demotion | null;
  /** Demote a word. Resolves once the file has it and the state is refreshed. */
  demote: (word: string, reason: DemotionReason) => Promise<void>;
}

export function useDemoter(date: string | null): Demoter {
  const [state, setState] = useState<DemotionState | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alreadyDemoted, setAlreadyDemoted] = useState(false);
  const [recorded, setRecorded] = useState<Demotion | null>(null);

  useEffect(() => {
    let current = true;

    void (async () => {
      try {
        const response = await fetch(EDITOR_DEMOTION_PATH);
        const result = await readEndpointResponse<DemotionState>(response, "demotion");
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setState(result.body);
      } catch (cause) {
        if (current) setError(endpointFailure(cause, "demotion"));
      }
    })();

    return () => {
      current = false;
    };
  }, []);

  // Kept apart from the fetch above, and keyed on the day rather than folded
  // into it: the standing list is day-independent and must not be re-read every
  // time the editor moves, but the banner it is reported alongside says a word
  // was *just* demoted, and carrying that sentence to another day would attribute
  // the write to the day now showing. `useTierPicker` clears `recorded` the same
  // way, for the same reason.
  useEffect(() => {
    setAlreadyDemoted(false);
    setRecorded(null);
  }, [date]);

  const demote = useCallback(async (word: string, chosen: DemotionReason) => {
    setWriting(word);
    setError(null);
    setAlreadyDemoted(false);
    try {
      const response = await fetch(EDITOR_DEMOTION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, reason: chosen }),
      });
      const outcome = await readEndpointResponse<DemotionWriteResult>(response, "demotion");
      if (!outcome.ok) {
        setError(outcome.error);
        setAlreadyDemoted(response.status === 409);
        return;
      }
      const result = outcome.body;
      setRecorded(result.appended);
      setState(result.state);
    } catch (cause) {
      setError(endpointFailure(cause, "demotion"));
    } finally {
      setWriting(null);
    }
  }, []);

  return { state, writing, error, alreadyDemoted, recorded, demote };
}
