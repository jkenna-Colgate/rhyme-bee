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
  aimClash,
  aimHeldFor,
  queueAdd,
  unqueueAdd,
  type AddAim,
  type AddSubmitRequest,
  type AddSubmitResult,
} from "./add.ts";
import { readEndpointResponse } from "./fetchError.ts";

export interface Adder {
  /** The words waiting, in the order they were typed. */
  queue: readonly string[];
  /**
   * The word half-typed into the entry and not yet queued.
   *
   * Held here rather than in `AddQueueView` for the same reason the queue is:
   * the entry lives on the day panel, and the day panel is unmounted whenever
   * the editor looks at another tab (#187). State kept in the view would make a
   * glance at the Candidate Queue mid-word cost the word, which is a thing the
   * stacked layout could not do and the tabs otherwise would.
   */
  typed: string;
  setTyped: (typed: string) => void;
  /**
   * Which of them came from the Candidate Queue rather than the editor's own
   * typing (#178). Kept beside the queue rather than inside it because it is a
   * fact about where a word came from and not about the word — every rule the
   * queue has (`queueAdd`, `unqueueAdd`, `aimHeldFor`, the cap) is indifferent
   * to it, and the one thing it decides is whether the reading written for it
   * carries a comment saying a player asked.
   */
  appealed: readonly string[];
  /**
   * What the standing queue is aimed at — a day, or a Rhyme Key a Candidate
   * supplied — or `null` when it is empty. The screen compares it with the day
   * on show; see `aimClash` and `aimHeldFor`.
   */
  aim: AddAim | null;
  /** A word refused before it cost anything: a duplicate, a typo, a full queue. */
  error: string | null;
  /**
   * True from the click until the whole act — adds, rebuild, re-read — is done,
   * whichever gesture started it.
   *
   * One flag over both, deliberately. A Submit and a paste accept write the same
   * file and run the same rebuild, so two of them in flight at once would race
   * over `data/supplement.dict` and rebuild the index twice from two different
   * halves of the night's work. Both buttons read this, so starting either one
   * disables the other.
   */
  submitting: boolean;
  /**
   * Whether the request in flight is the pasted pile's rather than the typed
   * queue's (#190).
   *
   * The paste panel needs it because a Submit can legitimately run for minutes
   * and both panels show progress against *their own* word count — without it,
   * a three-word Submit from the day tab would draw a "this can run to 197
   * minutes" line under the paste box, about a batch that is not running.
   */
  accepting: boolean;
  /** Milliseconds since the click, so a long Submit is visibly running. */
  elapsedMs: number;
  /** The last Submit's answer, kept on screen until the next one or a day change. */
  result: AddSubmitResult | null;
  /** A Submit that produced no answer at all, or one the endpoint refused. */
  submitError: string | null;
  /**
   * Queue a word against an aim, which binds the queue to it.
   *
   * `fromCandidate` is how the Candidate Queue's one-gesture add reaches this
   * hook: the same call the typed add makes, with the word prefilled, its
   * provenance recorded and — from the whole-queue list, where there is no day —
   * the Candidate's own Rhyme Key as the aim. Everything after it is identical,
   * which is the point: an add raised from a Candidate must not be a second add
   * path.
   */
  queueWord: (typed: string, aim: AddAim, fromCandidate?: boolean) => void;
  unqueueWord: (word: string) => void;
  /**
   * Run the queue against its own aim, rebuild, and re-read the day on screen.
   * The date is the day showing, not the aim: an empty Submit is aimed at
   * nothing and a key-aimed one is aimed somewhere the screen is not.
   */
  submit: (date: string) => Promise<void>;
  /**
   * Accept a batch of words the editor never typed — the pasted rhyme list's
   * main pile (#190) — aimed at the day on screen.
   *
   * **The same route, the same request shape, the same rebuild.** Not a second
   * write path, which is the constraint #186 puts at the centre of this feature:
   * `resolveAddOutcome` already takes an array of words and already produces
   * exactly the outcomes the paste panel needs, so what is new here is a caller
   * and nothing else.
   *
   * Separate from `submit` for one reason: it must not touch the typed queue.
   * The queue is bound to an aim, survives a day change on purpose, and is
   * emptied only by an answer to its own Submit — routing the pile through it
   * would clash with a standing queue aimed elsewhere, and would empty the
   * editor's typing on an accept they made from another tab.
   *
   * Always **day-aimed**, never key-aimed: the pile was joined against the day
   * on screen, so the endpoint resolves the key from `data/schedule.json` exactly
   * as it does for a typed add. Nothing here carries a Rhyme Key of the browser's
   * own, which is the hole #161 closed and this does not reopen.
   *
   * `appealed` is empty and stays empty. Nobody Appealed these words — a third
   * party's rhyme list nominated them — and the provenance comment that flag
   * writes into `data/supplement.dict` would be saying something untrue.
   *
   * Uncapped here. What bounds the batch is `MAX_SUBMITTED_WORDS` at the route,
   * and it is a transport bound rather than a workload one; the pile goes in one
   * request, because one request is one append, one rebuild and one re-read.
   */
  accept: (words: readonly string[], date: string) => Promise<void>;
}

/** How often the elapsed clock is redrawn while a Submit is in flight. */
const TICK_MS = 500;

export function useAdder(onDay: (readout: DayReadout) => void, date: string | null): Adder {
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState("");
  const [appealed, setAppealed] = useState<readonly string[]>([]);
  const [aim, setAim] = useState<AddAim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepting, setAccepting] = useState(false);
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
  const standing = useRef<{
    queue: readonly string[];
    appealed: readonly string[];
    aim: AddAim | null;
  }>({ queue: [], appealed: [], aim: null });
  const hold = useCallback(
    (next: readonly string[], raised: readonly string[], at: AddAim | null): void => {
      // A queue with nothing in it is aimed at nothing, which is what lets the
      // editor start a fresh one wherever they are after submitting or clearing.
      const boundTo = next.length === 0 ? null : at;
      // Narrowed to the queue on every write rather than trusted to be kept in
      // step: `unqueueAdd` is the queue's own rule for removal and this list
      // must not be a second opinion about which words are still waiting.
      const kept = raised.filter((word) => next.includes(word));
      standing.current = { queue: next, appealed: kept, aim: boundTo };
      setQueue(next);
      setAppealed(kept);
      setAim(boundTo);
    },
    [],
  );

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
  // This `date` is a display key and nothing more. It does not replace the aim
  // that `queueWord` is given at the call: the queue's binding is `aim`, checked
  // by `aimClash` below, and the `standing` ref this
  // effect deliberately does not touch. Letting `AddQueueView` hold the day
  // alongside `result` and decide whether to render it was rejected — that puts a
  // correctness rule in a view no test can reach.
  useEffect(() => {
    setResult(null);
  }, [date]);

  const queueWord = useCallback(
    (typed: string, at: AddAim, fromCandidate = false) => {
      // Refused before the word is normalised or judged: a word aimed at one
      // target cannot join a queue aimed at another, or one of the two would be
      // written against a Rhyme Key nothing on screen named.
      const clash = aimClash(standing.current.aim, at);
      if (clash !== null) return setError(clash);

      const asked = queueAdd(standing.current.queue, typed);
      if (!asked.ok) return setError(asked.error);
      setError(null);
      // The word as `queueAdd` normalised it, not as it arrived: the provenance
      // has to be recorded under the spelling the batch and the endpoint will
      // both use, or the note would be attached to a word that is not there.
      const raised = asked.queue[asked.queue.length - 1]!;
      hold(
        asked.queue,
        fromCandidate ? [...standing.current.appealed, raised] : standing.current.appealed,
        at,
      );
    },
    [hold],
  );

  const unqueueWord = useCallback(
    (word: string) => {
      setError(null);
      hold(
        unqueueAdd(standing.current.queue, word),
        standing.current.appealed,
        standing.current.aim,
      );
    },
    [hold],
  );

  /**
   * Post one batch and take what comes back: the outcome on screen, the day
   * re-read from the index the rebuild produced, and whatever the caller settles
   * on an answer.
   *
   * Shared by the typed Submit and the pasted accept (#190) because there is one
   * route and one rebuild behind both, and a second copy of this would be a
   * second place for the two to drift on what a failure means. What differs
   * between them is a callback and a clause, and both are arguments.
   *
   * `settled` runs only on an answer the endpoint gave — never on a refusal and
   * never on a connection that broke — because what it does is discard work the
   * editor would otherwise have to redo.
   */
  const post = useCallback(
    async (payload: AddSubmitRequest, settled: () => void, kept: string): Promise<void> => {
      setSubmitting(true);
      setError(null);
      setSubmitError(null);
      try {
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
        settled();
        if (answered.readout !== null) day.current(answered.readout);
      } catch (cause) {
        // Deliberately not `endpointFailure`, whose sentence ends "Nothing was
        // written." That is true of the Tier and demotion routes, which answer
        // before they write; it is not knowable here — a request whose connection
        // broke may have written some of the batch already. What can be said
        // instead is the more useful thing: sending it again is safe, because a
        // word that did land comes back as one that already reads and is left
        // alone.
        setSubmitError(
          `${cause instanceof Error ? cause.message : "The add endpoint could not be reached."} ` +
            `— is the dev server still running? ${kept}, and sending it again is safe: ` +
            "a word that did get written comes back as one that already reads, and is left alone.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const submit = useCallback(async (date: string) => {
    // The queue as it stands at the click, not as it stood when this callback
    // was built — the callback is deliberately stable across renders.
    const { queue: batch, appealed: raised, aim: boundTo } = standing.current;

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

    // Built as an `AddSubmitRequest` rather than as a literal, so the body this
    // posts is checked against the shape the endpoint's parser returns rather
    // than agreeing with it by hand. Copied out because the queue is held
    // readonly and the declared field is not — the copy is inert, since `post`
    // serialises it and the endpoint parses its own.
    //
    // The date always travels and is always the day on screen: it is what the
    // aim is resolved from for a day-aimed queue, and what the answer re-reads
    // for every other kind. The key travels only when the queue has one, which
    // is what makes it the aim rather than a second opinion about the day.
    await post(
      {
        date,
        words: [...batch],
        appealed: [...raised],
        ...(boundTo?.kind === "key" ? { rhymeKey: boundTo.rhymeKey } : {}),
      },
      // The queue empties only on an answer, and empties its binding with it. A
      // refused or unreachable Submit leaves both exactly as they were, because
      // the words are then still missing from the game and retyping them is the
      // one cost this whole design exists to avoid.
      () => hold([], [], null),
      "The queue is kept",
    );
  }, [hold, post]);

  /**
   * The pasted pile, accepted whole (#190).
   *
   * Nothing is emptied on the answer, unlike `submit`: the paste is not a queue
   * and is not consumed by being acted on. What takes an accepted word off the
   * pile is the **re-read** — `post` hands the fresh readout to the day, the
   * join runs again against it, and a word that got a reading is now covered by
   * the Puzzle. So the editor never re-pastes, and the words that did not land
   * are still on screen to be looked at.
   *
   * An empty batch returns without a request. `submit` deliberately posts one —
   * an empty Submit is #162's rebuild-only gesture, decided at the endpoint
   * against the disk — but there is no such gesture here: an accept with nothing
   * to accept is a button that should not have been pressable, and the rebuild
   * it would run is already one click away on the day tab.
   */
  const accept = useCallback(
    async (words: readonly string[], date: string) => {
      if (words.length === 0) return;
      setAccepting(true);
      try {
        // No `rhymeKey` and no `appealed`: the pile was joined against the day
        // on screen, so the endpoint resolves the key from the schedule, and
        // nobody Appealed a word a third party's list nominated.
        await post({ date, words: [...words], appealed: [] }, () => {}, "The paste is kept");
      } finally {
        setAccepting(false);
      }
    },
    [post],
  );

  return {
    queue,
    typed,
    setTyped,
    appealed,
    aim,
    error,
    submitting,
    accepting,
    elapsedMs,
    result,
    submitError,
    queueWord,
    unqueueWord,
    submit,
    accept,
  };
}
