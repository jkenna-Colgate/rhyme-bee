/**
 * The Decline gesture's data layer: the one call that adds a ruling to
 * `data/declines.txt`.
 *
 * Modelled on `useDemoter`, which is the gesture beside it on every card, and
 * differing in the places the two acts differ.
 *
 * ## Why this hook holds no copy of the standing rulings
 *
 * Because nothing on the screen is drawn from one. Which Candidates are already
 * declined is `state: "declined"` on the queue readout, derived server-side from
 * the file on every read (`scripts/editorCandidates.ts`) — deriving it in one
 * place is the point (#176), and a second copy fetched here would be a second
 * answer to the same question, disagreeing with the first the moment either
 * moved. So this hook writes and reports what it wrote, and the file's own state
 * reaches the screen the one way it already did.
 *
 * That is also why the route has no `GET`: a payload built and served for nobody
 * is a payload whose shape nothing holds to account.
 *
 * ## Why there is no local edit buffer
 *
 * `decline` removes nothing itself. It posts the word and the Rhyme Key and
 * waits for the endpoint to append them. That round trip is a few milliseconds
 * on localhost, and paying it buys the property the Tier picker and the demote
 * gesture are both built around: **nothing is ever off the screen that is not on
 * the disk**. What actually takes the Candidate off the queue is the readout
 * being asked again — `EditorApp` refreshes it on this hook's `recorded`,
 * exactly as it does on a demotion — so an optimistic local copy would be a
 * second model of a state that is derived server-side and would be wrong the
 * moment a write failed.
 *
 * ## Why the hook takes a day at all
 *
 * For the *banner*, and nothing else: `recorded` reports a ruling the editor
 * just made, and a ruling made while reading one day is not news on another.
 * `useDemoter` clears its own the same way, for the same reason. The ruling
 * itself is about a word aimed at a Rhyme Key, and neither is a date — 17 of the
 * 33 standing Candidates belong to no scheduled day at all.
 *
 * ## Why a failed write is quiet, where a failed demotion is loud
 *
 * This is the one place the two part company. A demotion that did not reach the
 * file leaves a name being served to players as an ordinary Answer, and the
 * editor's next act is to click the next word — so it is worth being noisy
 * about. A Decline that did not reach the file changes nothing whatever: no
 * verdict, no Puzzle, no figure. Its whole cost is that one Candidate is still
 * on the queue next time, which is where it was anyway. So the error is reported
 * where it happened and nothing else stops.
 */

import { useCallback, useEffect, useState } from "react";
import type { Decline } from "../../../src/declines.ts";
import { EDITOR_DECLINE_PATH } from "../endpoints.ts";
import type { DeclineWriteResult } from "./decline.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";

export interface Decliner {
  /** A ruling in flight, so the word clicked can say it is being written. */
  writing: string | null;
  /** A request that produced no answer, or a write the file refused. */
  error: string | null;
  /** The last ruling recorded, kept on screen until the next one or a day change. */
  recorded: Decline | null;
  /** Decline a Candidate. Resolves once the file has it. */
  decline: (word: string, rhymeKey: string) => Promise<void>;
}

export function useDecliner(date: string | null): Decliner {
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Decline | null>(null);

  // Keyed on the day for `useDemoter`'s reason: the banner says a Candidate was
  // *just* declined, and carrying that sentence to another day would attribute
  // the ruling to the day now showing.
  useEffect(() => {
    setRecorded(null);
  }, [date]);

  const decline = useCallback(async (word: string, rhymeKey: string) => {
    setWriting(word);
    setError(null);
    try {
      const response = await fetch(EDITOR_DECLINE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, rhymeKey }),
      });
      const outcome = await readEndpointResponse<DeclineWriteResult>(response, "Decline");
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setRecorded(outcome.body.appended);
    } catch (cause) {
      setError(endpointFailure(cause, "Decline"));
    } finally {
      setWriting(null);
    }
  }, []);

  return { writing, error, recorded, decline };
}
