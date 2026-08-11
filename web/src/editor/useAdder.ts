/**
 * The add queue's data layer: the words waiting, and the one call that makes
 * them real.
 *
 * ## Why queueing touches no server
 *
 * Everything up to Submit is `queueAdd`, `unqueueAdd` and `aimHeldFor` over a
 * `string[]` and the date it was typed against — no fetch, no optimistic state,
 * nothing to fail. That is the ticket's central property rather than an
 * implementation shortcut: naming ten words has to cost what naming one costs,
 * and a mistyped word has to be removable before it costs anything. The moment a
 * queued word touched `data/supplement.dict` it would stop being removable, and
 * the editor would be composing their list one irreversible act at a time.
 *
 * All three are pure and live in `add.ts`, which is where they are tested; this
 * hook is the state around them and holds no rule of its own.
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
import {
  aimHeldFor,
  queueAdd,
  unqueueAdd,
  type AddSubmitRequest,
  type AddSubmitResult,
} from "./add.ts";
import { readEndpointResponse } from "./fetchError.ts";

export interface Adder {
  /** The words waiting, in the order they were typed. */
  queue: readonly string[];
  /**
   * The date the standing queue was typed against, or `null` when it is empty.
   * The screen compares it with the day on show; see `aimHeldFor`.
   */
  queuedFor: string | null;
  /** A word refused before it cost anything: a duplicate, a typo, a full queue. */
  error: string | null;
  /** True from the click until the whole act — adds, rebuild, re-read — is done. */
  submitting: boolean;
  /** Milliseconds since the click, so a long Submit is visibly running. */
  elapsedMs: number;
  /** The last Submit's answer, kept on screen until the next one or a day change. */
  result: AddSubmitResult | null;
  /** A Submit that produced no answer at all, or one the endpoint refused. */
  submitError: string | null;
  /** Queue a word against the day on screen, which binds the queue to it. */
  queueWord: (typed: string, date: string) => void;
  unqueueWord: (word: string) => void;
  /** Run the queue against the day's Rhyme Key, rebuild, and re-read the day. */
  submit: (date: string) => Promise<void>;
}

/** How often the elapsed clock is redrawn while a Submit is in flight. */
const TICK_MS = 500;

export function useAdder(onDay: (readout: DayReadout) => void, date: string | null): Adder {
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
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

  // The queue and the day it is bound to, mirrored in a ref, because the three
  // callbacks below are deliberately stable across renders and so cannot read
  // either off a closure. The obvious alternative — reading them out of a
  // `setQueue` updater, which is what this hook used to do — leans on React
  // evaluating updaters eagerly. That is an unguaranteed fast path: with an
  // update already pending the updater is deferred, and `submit` would then post
  // an empty batch and return having silently done nothing. A ref is the honest
  // read, so every write goes through `hold` and nothing sets `queue` directly.
  const standing = useRef<{ queue: readonly string[]; queuedFor: string | null }>({
    queue: [],
    queuedFor: null,
  });
  const hold = useCallback((next: readonly string[], date: string | null): void => {
    // A queue with nothing in it is bound to no day, which is what lets the
    // editor start a fresh one wherever they are after submitting or clearing.
    const boundTo = next.length === 0 ? null : date;
    standing.current = { queue: next, queuedFor: boundTo };
    setQueue(next);
    setQueuedFor(boundTo);
  }, []);

  useEffect(() => {
    if (!submitting) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(timer);
  }, [submitting]);

  // The Submitted section reports what a batch did to *a* day — each word's
  // outcome and the Rhyme Key it was judged against — so it stops being true the
  // moment the editor moves to another day, and is cleared rather than left to
  // sit under the wrong Daily Puzzle.
  //
  // This `date` is a display key and nothing more. It does not replace the `date`
  // that `queueWord` and `submit` are each given at the call: the queue's binding
  // is `queuedFor`, checked by `aimHeldFor` below, and the `standing` ref this
  // effect deliberately does not touch. Letting `AddQueueView` hold the day
  // alongside `result` and decide whether to render it was rejected — that puts a
  // correctness rule in a view no test can reach.
  useEffect(() => {
    setResult(null);
  }, [date]);

  const queueWord = useCallback(
    (typed: string, date: string) => {
      // Refused before the word is normalised or judged: a word typed on one day
      // cannot join a queue aimed at another, or it would be written against a
      // Rhyme Key the editor was not looking at when they typed it.
      const held = aimHeldFor(standing.current.queuedFor, date);
      if (held !== null) return setError(held);

      const asked = queueAdd(standing.current.queue, typed);
      if (!asked.ok) return setError(asked.error);
      setError(null);
      hold(asked.queue, date);
    },
    [hold],
  );

  const unqueueWord = useCallback(
    (word: string) => {
      setError(null);
      hold(unqueueAdd(standing.current.queue, word), standing.current.queuedFor);
    },
    [hold],
  );

  const submit = useCallback(async (date: string) => {
    // The queue as it stands at the click, not as it stood when this callback
    // was built — the callback is deliberately stable across renders.
    const { queue: batch, queuedFor: boundTo } = standing.current;

    // An empty queue is **posted**, not dropped here, which is #162's widening.
    // It used to return early, back when an empty Submit could only ever be a
    // misfire. It can now be the whole point of the click: a night of Tier
    // verdicts is on disk, the artifact predates them, and the rebuild is what
    // makes them real. Whether that is the case is a fact about the disk, and
    // this hook's copy of it — `pendingWork` over a status fetched some
    // milliseconds ago — is the wrong thing to enforce a refusal with. The
    // endpoint asks `indexStaleness` at the moment of the request and refuses
    // in a sentence, which is both fresher and the only enforcement that
    // cannot be got round.
    //
    // The button is still disabled on an empty queue and a current index, for
    // the reason every disabled button here exists: to say what will happen
    // before it does not.

    // The button that calls this is already disabled on a mismatch. It is
    // checked again because a rule only a button enforces is not a rule, and
    // because this is the last point at which a batch can still be stopped from
    // landing on another day's Rhyme Key.
    const held = aimHeldFor(boundTo, date);
    if (held !== null) {
      setSubmitError(held);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitError(null);
    try {
      // Built as an `AddSubmitRequest` rather than as a literal, so the body
      // this posts is checked against the shape the endpoint's parser returns
      // rather than agreeing with it by hand. The queue is held readonly and
      // copied out here; the copy is what gets serialised either way.
      const payload: AddSubmitRequest = { date, words: [...batch] };
      const response = await fetch(EDITOR_ADD_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const outcome = await readEndpointResponse<AddSubmitResult>(response, "add");
      if (!outcome.ok) {
        setSubmitError(outcome.error);
        return;
      }
      const answered = outcome.body;
      setResult(answered);
      // The queue empties only on an answer, and empties its binding with it. A
      // refused or unreachable Submit leaves both exactly as they were, because
      // the words are then still missing from the game and retyping them is the
      // one cost this whole design exists to avoid.
      hold([], null);
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
  }, [hold]);

  return {
    queue,
    queuedFor,
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
