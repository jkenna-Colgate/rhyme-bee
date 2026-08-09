/**
 * The add queue's data layer: the words waiting, and the one call that makes
 * them real.
 *
 * ## Why queueing touches no server
 *
 * Everything up to Submit is `queueAdd` and `unqueueAdd` over a `string[]` in
 * this hook — no fetch, no optimistic state, nothing to fail. That is the
 * ticket's central property rather than an implementation shortcut: naming ten
 * words has to cost what naming one costs, and a mistyped word has to be
 * removable before it costs anything. The moment a queued word touched
 * `data/supplement.dict` it would stop being removable, and the editor would be
 * composing their list one irreversible act at a time.
 *
 * ## Why the fresh readout is handed away rather than held
 *
 * Submit answers with the day re-read from the index it has just rebuilt, and
 * that readout is **the day** — the thing `useDayReadout` owns. Keeping a copy
 * here would put two models of one day on one screen, and the moment they
 * disagreed the figures shown would depend on which component rendered them. So
 * it goes straight to `onDay` and this hook keeps no day at all.
 *
 * Taking it from the response rather than refetching afterwards is also what
 * makes Submit one act: a second `GET` would leave a window in which the screen
 * still shows the day from before the pass, and a second request that failed
 * would leave the editor believing the pass had not landed when it had.
 *
 * ## What a long Submit shows, and why it is not a progress bar
 *
 * A word no compound split reaches is sent to an agent that is given up to a
 * minute (`AGENT_TIMEOUT_MS`, `scripts/editorAdd.ts`), and those waits are
 * serial — so a batch can legitimately run for minutes, during which one POST is
 * in flight and nothing comes back. A button that simply sat there disabled
 * would be indistinguishable from a hung tab, which is why `elapsedMs` ticks:
 * the screen can show the seconds going by and the worst case they are going by
 * against, so a slow Submit is visibly *running* rather than frozen.
 *
 * Two more honest-looking options were rejected. **Streaming the outcome per
 * word** (SSE, or a chunked body) would give real progress and costs a second
 * transport shape, a second parser and a second failure mode, on one screen in
 * one dev server. **Posting one word per request** would give the same progress
 * with no new transport, and is worse: `resolveAddOutcome` judges a batch
 * against a single evidence context taken before the first word, so splitting it
 * would let a word written by one request become a compound part of the next —
 * making the order the editor typed in significant, which is precisely what
 * `evidenceContext`'s doc comment says the batch is shaped to avoid. The browser
 * would then be running a different algorithm from the CLI over the same words.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { EDITOR_ADD_PATH } from "../endpoints.ts";
import { queueAdd, unqueueAdd, type AddSubmitResult } from "./add.ts";
import { errorIn } from "./fetchError.ts";

export interface Adder {
  /** The words waiting, in the order they were typed. */
  queue: readonly string[];
  /** A word refused before it cost anything: a duplicate, a typo, a full queue. */
  error: string | null;
  /** True from the click until the whole act — adds, rebuild, re-read — is done. */
  submitting: boolean;
  /** Milliseconds since the click, so a long Submit is visibly running. */
  elapsedMs: number;
  /** The last Submit's answer, kept on screen until the next one. */
  result: AddSubmitResult | null;
  /** A Submit that produced no answer at all, or one the endpoint refused. */
  submitError: string | null;
  queueWord: (typed: string) => void;
  unqueueWord: (word: string) => void;
  /** Run the queue against the day's Rhyme Key, rebuild, and re-read the day. */
  submit: (date: string) => Promise<void>;
}

/** How often the elapsed clock is redrawn while a Submit is in flight. */
const TICK_MS = 500;

export function useAdder(onDay: (readout: DayReadout) => void): Adder {
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<AddSubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The callback is read through a ref so the `submit` identity below does not
  // change every time the day does — `submit` is handed to a button, and a
  // button whose handler is rebuilt on every readout is a needless re-render of
  // the whole queue while a Submit is in flight.
  const day = useRef(onDay);
  day.current = onDay;

  useEffect(() => {
    if (!submitting) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(timer);
  }, [submitting]);

  const queueWord = useCallback((typed: string) => {
    setQueue((standing) => {
      const asked = queueAdd(standing, typed);
      setError(asked.ok ? null : asked.error);
      return asked.ok ? asked.queue : standing;
    });
  }, []);

  const unqueueWord = useCallback((word: string) => {
    setError(null);
    setQueue((standing) => unqueueAdd(standing, word));
  }, []);

  const submit = useCallback(async (date: string) => {
    // Read out of the setter rather than off the closure, so the batch posted is
    // the queue as it stands at the click and not as it stood when this callback
    // was built — the callback is deliberately stable across renders.
    let batch: readonly string[] = [];
    setQueue((standing) => {
      batch = standing;
      return standing;
    });
    if (batch.length === 0) return;

    setSubmitting(true);
    setError(null);
    setSubmitError(null);
    try {
      const response = await fetch(EDITOR_ADD_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, words: batch }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setSubmitError(errorIn(body) ?? `The add endpoint answered ${response.status}.`);
        return;
      }
      const answered = body as AddSubmitResult;
      setResult(answered);
      // The queue empties only on an answer. A refused or unreachable Submit
      // leaves it exactly as it was, because the words are then still missing
      // from the game and retyping them is the one cost this whole design
      // exists to avoid.
      setQueue([]);
      if (answered.readout !== null) day.current(answered.readout);
    } catch (cause) {
      // Deliberately not `endpointFailure`, whose sentence ends "Nothing was
      // written." That is true of the Tier and demotion routes, which answer
      // before they write; it is not knowable here — a Submit whose connection
      // broke may have written some of the batch already. What can be said
      // instead is the more useful thing: resubmitting is safe, because a word
      // that did land comes back as one that already reads and is left alone.
      setSubmitError(
        `${cause instanceof Error ? cause.message : "The add endpoint could not be reached."} ` +
          "— is the dev server still running? The queue is kept, and submitting it again is safe: " +
          "a word that did get written comes back as one that already reads, and is left alone.",
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  return {
    queue,
    error,
    submitting,
    elapsedMs,
    result,
    submitError,
    queueWord,
    unqueueWord,
    submit,
  };
}
