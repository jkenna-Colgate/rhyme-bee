/**
 * The correction gesture's data layer: the two calls the one correction route
 * answers, and the proposal held between them.
 *
 * Modelled on `useDecliner` and `useDemoter`, and differing where the act does.
 *
 * ## Why the proposal is held here and nowhere else
 *
 * It is the one piece of state in the tool that exists **only** in the browser,
 * and deliberately: asking an agent for a reading writes nothing, so there is no
 * file for the readout to derive it from and nothing on disk to disagree with. A
 * proposal the editor walks away from is meant to leave no trace, which is what
 * makes asking for one free (ADR-0017). Holding it on the server between the two
 * requests would be the opposite — a second copy of a fact, whose being wrong
 * writes an approval the editor never saw.
 *
 * **One at a time.** The hook holds the last proposal asked for, and a card
 * shows it only when it names that card's own word and Rhyme Key. Judging one
 * correction is reading two readings side by side, and a screen holding four of
 * those at once is a screen nobody is judging from — the second click is the
 * point of the first, which is `DECLINE_CHOICES`'s argument on the card beside
 * this one.
 *
 * ## Why there is no local edit buffer
 *
 * `approve` removes nothing itself and changes no figure on screen. It posts the
 * reading and waits for the endpoint to write it, rebuild the index and recheck
 * the days — which is seconds rather than milliseconds, and is why `busy` names
 * the word rather than being a bare flag. What actually takes the Candidate off
 * the queue is the readout being asked again; `EditorApp` refreshes it on this
 * hook's `result`, exactly as it does on a Decline.
 *
 * ## Why a failed correction is loud
 *
 * Unlike a Decline, which changes nothing whatever when it fails, a correction
 * that did not land leaves the engine reading a word the way the editor has just
 * decided is wrong — and, if it failed *after* the write, leaves the reading on
 * disk with the index not yet holding it. So the error stays on screen next to
 * the proposal that produced it rather than being reported and forgotten.
 */

import { useCallback, useState } from "react";
import type { Pronunciation, RhymeKey } from "../../../src/phonology.ts";
import { EDITOR_CORRECTION_PATH } from "../endpoints.ts";
import type {
  CorrectionMode,
  CorrectionOutcome,
  CorrectionWriteResult,
} from "./correction.ts";
import { endpointFailure, readEndpointResponse } from "./fetchError.ts";

export interface Corrector {
  /** The word a request is in flight for, so its card can say so. */
  busy: string | null;
  /** A request that produced no answer, or a write the endpoint refused. */
  error: string | null;
  /** The proposal on screen, written nowhere. Null until one is asked for. */
  proposal: CorrectionOutcome | null;
  /** The last correction that landed: what was written, and what moved. */
  result: CorrectionWriteResult | null;
  /** Ask an agent for a reading. Writes nothing. */
  propose: (word: string, rhymeKey: RhymeKey) => Promise<void>;
  /** Approve one, replacing the engine's reading or joining it. */
  approve: (
    word: string,
    rhymeKey: RhymeKey,
    phonemes: Pronunciation,
    mode: CorrectionMode,
  ) => Promise<void>;
  /** Put a proposal down without approving it. Nothing was written. */
  dismiss: () => void;
}

export function useCorrector(): Corrector {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CorrectionOutcome | null>(null);
  const [result, setResult] = useState<CorrectionWriteResult | null>(null);

  const post = useCallback(async <T,>(word: string, body: unknown, what: string): Promise<T | null> => {
    setBusy(word);
    setError(null);
    try {
      const response = await fetch(EDITOR_CORRECTION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const outcome = await readEndpointResponse<T>(response, what);
      if (!outcome.ok) {
        setError(outcome.error);
        return null;
      }
      return outcome.body;
    } catch (cause) {
      setError(endpointFailure(cause, what));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const propose = useCallback(
    async (word: string, rhymeKey: RhymeKey) => {
      // The previous proposal goes first, so a slow agent cannot leave the old
      // reading on screen looking like an answer to the new question.
      setProposal(null);
      setResult(null);
      const outcome = await post<CorrectionOutcome>(word, { word, rhymeKey }, "correction");
      if (outcome !== null) setProposal(outcome);
    },
    [post],
  );

  const approve = useCallback(
    async (word: string, rhymeKey: RhymeKey, phonemes: Pronunciation, mode: CorrectionMode) => {
      const written = await post<CorrectionWriteResult>(
        word,
        { word, rhymeKey, phonemes, mode },
        "correction",
      );
      if (written === null) return;
      // The proposal is spent: it is on disk now, and leaving it on screen would
      // offer the editor a second approval of a reading already written.
      setProposal(null);
      setResult(written);
    },
    [post],
  );

  const dismiss = useCallback(() => {
    setProposal(null);
    setError(null);
  }, []);

  return { busy, error, proposal, result, propose, approve, dismiss };
}
