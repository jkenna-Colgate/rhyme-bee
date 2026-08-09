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
 * ## Why a failed write is loud
 *
 * A demotion that did not reach the file is a demotion that did not happen, and
 * the word is still being served as an ordinary Answer. That is the failure
 * worth being noisy about: the editor's next act is to click the next word, and
 * a silently dropped write would leave a name in tomorrow's Puzzle.
 */

import { useCallback, useEffect, useState } from "react";
import type { Demotion, DemotionReason } from "../../../src/demotions.ts";
import { EDITOR_DEMOTION_PATH } from "../endpoints.ts";
import type { DemotionState, DemotionWriteResult } from "./demote.ts";

export interface Demoter {
  state: DemotionState | null;
  /** A demotion in flight, so the word clicked can say it is being written. */
  writing: string | null;
  /** A request that produced no state, or a write the file refused. */
  error: string | null;
  /** The last demotion recorded, kept on screen until the next one. */
  recorded: Demotion | null;
  /** Demote a word. Resolves once the file has it and the state is refreshed. */
  demote: (word: string, reason: DemotionReason) => Promise<void>;
}

export function useDemoter(): Demoter {
  const [state, setState] = useState<DemotionState | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Demotion | null>(null);

  useEffect(() => {
    let current = true;

    void (async () => {
      try {
        const response = await fetch(EDITOR_DEMOTION_PATH);
        const body: unknown = await response.json();
        if (!current) return;
        if (!response.ok) {
          setError(errorIn(body) ?? `The demotion endpoint answered ${response.status}.`);
          return;
        }
        setError(null);
        setState(body as DemotionState);
      } catch (cause) {
        if (current) setError(reason(cause));
      }
    })();

    return () => {
      current = false;
    };
  }, []);

  const demote = useCallback(async (word: string, chosen: DemotionReason) => {
    setWriting(word);
    setError(null);
    try {
      const response = await fetch(EDITOR_DEMOTION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, reason: chosen }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(errorIn(body) ?? `The demotion endpoint answered ${response.status}.`);
        return;
      }
      const result = body as DemotionWriteResult;
      setRecorded(result.appended);
      setState(result.state);
    } catch (cause) {
      setError(reason(cause));
    } finally {
      setWriting(null);
    }
  }, []);

  return { state, writing, error, recorded, demote };
}

/** The sentence the endpoint sent, when it sent one. */
function errorIn(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  return typeof error === "string" ? error : null;
}

function reason(cause: unknown): string {
  return cause instanceof Error
    ? `${cause.message} — is the dev server still running? Nothing was written.`
    : "The demotion endpoint could not be reached. Nothing was written.";
}
