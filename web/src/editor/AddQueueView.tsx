/**
 * The add queue and Submit, rendered to a screen — the half of the Editor's Pass
 * that *corrects* the day rather than reads it (#161).
 *
 * Its own file rather than another section of `DayReadoutView.tsx`, which is
 * already the longest module on this screen: what is drawn here is not a view of
 * the day at all. It is a list the browser is holding, and it happens to sit
 * beside a day because the day is what supplies the Rhyme Key.
 *
 * It renders above the two word lists on purpose. The pass is conducted by
 * running the day's Answers and Bonus Words against a third-party rhyme list in
 * another window, and a day can hold hundreds of words — a queue below them
 * would be off the bottom of the screen at exactly the moment the editor spots
 * the gap and wants to type it.
 *
 * The key is shown but never typed. Every queued word is aimed at the day's own
 * Rhyme Key, resolved from `data/schedule.json` by the endpoint; showing it is
 * how the editor can *check* the aim, and there is deliberately no control that
 * changes it.
 *
 * The one gesture here that is not an add is `ReadsElsewhere` below: a word the
 * index turns out to hold on another key, reported with the keys it is held on,
 * and offered a single click that records the disagreement as a Candidate
 * (#163). It writes no reading and proposes none — see that component for why
 * the two acts are kept apart.
 */

import { useState } from "react";
import type {
  DeferredOutcome,
  ReadsOnAnotherKeyOutcome,
  WordOutcome,
} from "../../../scripts/editorAdd.ts";
import type { RhymeKey } from "../../../src/phonology.ts";
import { MAX_QUEUED_WORDS, aimHeldFor, type AddSubmitResult } from "./add.ts";
import { disagreementReport } from "./disagreement.ts";
import { pendingWork, type EditorStatus } from "./status.ts";
import type { Adder } from "./useAdder.ts";
import type { Disagreer } from "./useDisagreement.ts";

/**
 * The worst case one word can cost, in milliseconds: the bound
 * `scripts/editorAdd.ts` puts on the agent it asks to author a reading no
 * compound split reaches. Restated here rather than imported because importing
 * it would pull the module that spawns processes into the browser bundle; it is
 * used only to say how long a Submit *might* take, so a copy that drifted would
 * cost an inaccurate sentence rather than an incorrect act.
 */
const WORST_CASE_MS_PER_WORD = 60_000;

export function AddQueueView({
  date,
  rhymeKey,
  adder,
  disagreer,
  status,
}: {
  date: string;
  rhymeKey: RhymeKey;
  adder: Adder;
  /** Recording a disagreement over a word the index holds on another key. */
  disagreer: Disagreer;
  /** The repository's state, for the half of Submit's rule that is not the queue. */
  status: EditorStatus | null;
}) {
  const [typed, setTyped] = useState("");
  const { queue, submitting } = adder;
  // The queue belongs to the day it was typed against, and this is the day on
  // screen. When they differ the queue is shown but cannot act — see
  // `aimHeldFor` for why it is neither cleared nor quietly resubmitted here.
  const held = aimHeldFor(adder.queuedFor, date);

  const queueTyped = () => {
    adder.queueWord(typed, date);
    // Cleared unconditionally, including on a refusal. The refusal names the
    // word it refused, so the field is not where the editor reads what went
    // wrong, and leaving a rejected word in it means the next word is typed
    // onto the end of it.
    setTyped("");
  };

  return (
    <section className="editor-add">
      <h3>
        Add missing words{" "}
        <span className="editor-muted">
          aimed at <code>{rhymeKey}</code>
        </span>
      </h3>

      <p className="editor-add-note">
        Words queue here and cost nothing until you submit. Submit gives each queued word a reading,
        writes what it can to <code>data/supplement.dict</code>, rebuilds the Rhyme Index and
        re-reads this day from the artifact that rebuild produced. A word that is a name is refused,
        and one that already reads correctly is left alone. It writes no Tier verdict and no
        demotion — those are on disk already, made when you clicked them, and an empty queue submits
        the rebuild alone so a night of them can be folded in without adding a word first.
      </p>

      <form
        className="editor-add-entry"
        onSubmit={(event) => {
          event.preventDefault();
          queueTyped();
        }}
      >
        <label className="editor-add-field">
          Word
          <input
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            // Shut while a queue bound to another day is standing, so the one
            // sentence explaining that is the only thing on screen saying it —
            // typing into a field that refuses every word with the same message
            // is the same message twice. `queueWord` refuses anyway.
            disabled={submitting || held !== null}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="editor-add-queue"
          disabled={submitting || typed === "" || held !== null}
        >
          Queue
        </button>
      </form>

      {/* Superseded by the held sentence rather than shown beside it. A refusal
          is about the last word typed, and the entry is shut while a queue is
          held — so anything still standing here is from the day the editor has
          just left, and reads as a second complaint about the day they are on. */}
      {adder.error !== null && held === null && (
        <p className="editor-add-refused">{adder.error}</p>
      )}

      {/* Above the queue, not below it: this sentence is the reason the words
          under it cannot be submitted, and a reader who meets the list first
          has already reached for the button. */}
      {held !== null && <p className="editor-add-held">{held}</p>}

      <Queued adder={adder} />

      <div className="editor-add-submit">
        <button
          type="button"
          className="editor-submit"
          // Enabled whenever anything is pending — a queued add, *or* rows
          // written to disk since the last rebuild (#162). The second half is
          // the widening: a night of Tier verdicts is real work waiting on a
          // rebuild, and before this it could only be folded in by queueing a
          // word the day did not need. What the old rule was protecting — an
          // empty Submit paying for a rebuild that folds in nothing — is still
          // protected: with nothing queued, `pendingWork` is true only when the
          // index's own staleness reason is `input-newer` — rows written since
          // the last rebuild, the one case this button's click actually folds
          // in — and false when the index holds everything, when no status has
          // arrived, and also when it is stale for a reason a rebuild cannot
          // answer (`no-artifact`, `missing-input`), which is what keeps this
          // button agreeing with what `StatusView` says about those two above
          // it. The endpoint asks `indexStaleness` itself rather than trusting
          // this: a rule only a button enforces is not a rule.
          //
          // Disabled too on a queue typed against another day. That rule is
          // not also enforced at the endpoint, because the endpoint cannot see
          // it: the date it receives is the only aim it has, and a Submit from
          // the wrong day is a perfectly well-formed request for the wrong
          // Rhyme Key. `submit` checks it again instead, so it is not a rule
          // only a button enforces.
          disabled={!pendingWork(queue.length, status) || submitting || held !== null}
          onClick={() => void adder.submit(date)}
        >
          {submitting ? "Submitting…" : submitLabel(queue.length)}
        </button>
        {submitting && <InFlight count={queue.length} elapsedMs={adder.elapsedMs} />}
      </div>

      {adder.submitError !== null && <p className="editor-write-failed">{adder.submitError}</p>}

      {adder.result !== null && <Submitted result={adder.result} disagreer={disagreer} />}
    </section>
  );
}

/**
 * What the button says it will do.
 *
 * An empty queue no longer means a button that cannot be pressed, so "Submit"
 * on its own is no longer a safe label for it: the act it performs then is a
 * rebuild and a re-read, with nothing written, and a button reading "Submit"
 * over an empty list invites the reasonable guess that it is about to submit
 * something. It names the act instead. When the index is also current the
 * button is disabled anyway, and the label is what says why the disabled state
 * is not a bug.
 */
function submitLabel(queued: number): string {
  if (queued === 0) return "Rebuild and re-read";
  return queued === 1 ? "Submit 1 word" : `Submit ${queued} words`;
}

/**
 * The queue itself. Every word is its own remove button, because taking a
 * mistyped word back out is the gesture that makes queueing cheap, and it should
 * cost the same one click on the word that queueing it did.
 *
 * In the order typed rather than alphabetical, unlike the day's word lists: this
 * list is short and the editor is looking for the word they just entered, which
 * is the last one.
 */
function Queued({ adder }: { adder: Adder }) {
  if (adder.queue.length === 0) {
    return (
      <p className="editor-muted">
        Nothing queued. Type a word the day is missing — nothing is written until you submit.
      </p>
    );
  }
  return (
    <ul className="editor-queued">
      {adder.queue.map((word) => (
        <li key={word}>
          <button
            type="button"
            className="editor-queued-word"
            title={`Take ${word} back out of the queue`}
            disabled={adder.submitting}
            onClick={() => adder.unqueueWord(word)}
          >
            <span className="editor-queued-text">{word}</span>
            <span className="editor-queued-remove" aria-hidden="true">
              ×
            </span>
            <span className="editor-visually-hidden">remove</span>
          </button>
        </li>
      ))}
      {adder.queue.length >= MAX_QUEUED_WORDS && (
        <li className="editor-muted">Queue is full — submit these, then queue the rest.</li>
      )}
    </ul>
  );
}

/**
 * What a Submit shows while it runs.
 *
 * A Submit is one request that can legitimately take minutes: a word no compound
 * split reaches is handed to an agent that is given up to a minute, and those
 * waits are serial. A disabled button on its own would be indistinguishable from
 * a hung tab at exactly that moment, so this says three things instead — what is
 * happening, how long it has been happening, and the worst case it is running
 * against. The seconds tick, which is what makes "slow" legible as "running".
 *
 * The bound is stated as a maximum and not as an estimate, because it is one:
 * nearly every word is composed from a compound split in milliseconds and never
 * reaches the agent at all. Quoting the typical case would be the number that
 * makes the slow batch feel broken.
 */
function InFlight({ count, elapsedMs }: { count: number; elapsedMs: number }) {
  const worstCaseMinutes = Math.ceil((count * WORST_CASE_MS_PER_WORD) / 60_000);
  return (
    <p className="editor-add-inflight" role="status">
      <strong>{Math.floor(elapsedMs / 1000)}s</strong> — writing {count === 1 ? "the word" : "the words"},
      then rebuilding the Rhyme Index (about 2 seconds). A word no compound split reaches waits on an
      agent for up to a minute, so this can run to {worstCaseMinutes}{" "}
      {worstCaseMinutes === 1 ? "minute" : "minutes"}. Nothing is lost if it does: every word is
      written or recorded as deferred.
    </p>
  );
}

/**
 * What became of the batch: the counts first, then every word with its own
 * outcome, in the order they were typed.
 *
 * The counts are the ticket's own two — written and deferred — and they are read
 * off the outcome rather than tracked while it ran, because the outcome is the
 * record of what reached the disk and a count kept anywhere else would be a
 * second opinion about a write.
 *
 * Every word gets a line, including the ones that were neither written nor
 * deferred. A word refused as a name and a word that already reads correctly are
 * both *answers* rather than failures, and a batch that reported only its
 * writes would leave the editor to work out which of the words they typed had
 * simply vanished.
 */
function Submitted({ result, disagreer }: { result: AddSubmitResult; disagreer: Disagreer }) {
  const { outcome, rebuilt, readout } = result;
  const written = outcome?.words.filter((w) => w.outcome === "written").length ?? 0;
  const deferred = outcome?.words.filter((w) => w.outcome === "deferred").length ?? 0;
  // Named once and read four times below, rather than repeating `outcome ===
  // null` at each site: the four sites are kept separate on purpose — a
  // summary paragraph, a qualifying clause inside the reload message, a whole
  // second sentence for a failed rebuild, and whether the per-word list
  // renders at all — and merging them into one branch would mean interleaving
  // four unrelated pieces of markup under one `if`. What they share is only
  // the test, which this is.
  const nothingQueued = outcome === null;

  return (
    <section className="editor-written">
      {/* An empty Submit says what it did rather than counting to zero twice.
          "0 readings written, 0 words deferred" is true of it and answers a
          question nobody asked: the button that ran it said *rebuild*, and
          what happened is that the verdicts and demotions already on disk
          became the artifact this day is now read off. */}
      {nothingQueued ? (
        <p>
          No words were queued, so nothing was written. What was already on disk — Tier verdicts,
          demotions, earlier adds — is what the rebuild below folded in.
        </p>
      ) : (
        <p>
          <strong>{written}</strong> {written === 1 ? "reading" : "readings"} written to{" "}
          <code>data/supplement.dict</code>, <strong>{deferred}</strong>{" "}
          {deferred === 1 ? "word" : "words"} deferred.
        </p>
      )}

      {rebuilt.ok ? (
        readout === null ? (
          <p className="editor-write-failed">
            The Rhyme Index was rebuilt, but this day could not be read back from it.
            {!nothingQueued && " The words above are written;"} reload to see the day.
          </p>
        ) : (
          <p className="editor-reach">
            The Rhyme Index was rebuilt and this day re-read from it — the figures above are the new
            artifact’s.
          </p>
        )
      ) : (
        <p className="editor-write-failed">
          {nothingQueued ? (
            <>
              <code>npm run build:index</code> failed, so this day is still being read off the
              artifact from before your corrections. Nothing was lost — they are on disk. Run it
              yourself and reload.
            </>
          ) : (
            <>
              The words above are written, but <code>npm run build:index</code> failed, so this day
              is still the one from before them. Run it yourself and reload.
            </>
          )}
          <br />
          <code className="editor-add-buildlog">{rebuilt.error}</code>
        </p>
      )}

      {/* One banner for the whole readout rather than one per word: a failed
          post is a fact about the endpoint, and every button on the list is
          about to fail the same way. */}
      {disagreer.error !== null && (
        <p className="editor-write-failed">
          {disagreer.error} <strong>Nothing was recorded</strong> — the disagreement is still only
          on this screen.
        </p>
      )}

      {!nothingQueued && (
        <ul className="editor-add-outcomes">
          {outcome.words.map((word) => (
            <li key={word.word} className={`editor-add-outcome editor-add-${word.outcome}`}>
              <strong>{word.word}</strong> —{" "}
              <WordOutcomeLine
                word={word}
                target={outcome.target}
                seed={outcome.seed ?? null}
                disagreer={disagreer}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One word's outcome in a sentence.
 *
 * The five cases are the ones `scripts/editorAdd.ts` distinguishes, and each is
 * said in the terms that module argues for: a name is *refused* rather than
 * deferred, because deferring says "later" and a name is never coming back; a
 * word that already reads on the key is confirmation and a word that reads on
 * another key is a correction, which is why the two are not one sentence about
 * "already known".
 */
function WordOutcomeLine({
  word,
  target,
  seed,
  disagreer,
}: {
  word: WordOutcome;
  target: RhymeKey;
  /**
   * The Seed Word the batch was aimed at, from the outcome itself rather than
   * from the day on screen — the two part company the moment an editor checks a
   * neighbouring day with a Submit's readout still standing. Null when the aim
   * named a Rhyme Key outright and there is no Puzzle behind it, which the CLI
   * allows and this screen does not.
   */
  seed: string | null;
  disagreer: Disagreer;
}) {
  switch (word.outcome) {
    case "refused-name":
      return (
        <>refused: it is a Proper Noun, and a Proper Noun stays one however well it rhymes.</>
      );
    case "already-reads":
      return (
        <>
          already reads on <code>{target}</code> — the reading an add would have written is there
          already, so nothing was written. Whether it is an Answer, a Bonus Word or in neither list
          is its wordhood and its Tier, which an add does not touch.
        </>
      );
    case "reads-on-another-key":
      return (
        <ReadsElsewhere word={word} target={target} seed={seed} disagreer={disagreer} />
      );
    case "written":
      return (
        <>
          written as <code>{word.phonemes.join(" ")}</code>
          {word.composed === null ? (
            <> — no compound split reached the key, so an agent authored it and it was verified.</>
          ) : (
            <>
              {" "}
              — composed from {word.composed.head.word} + {word.composed.tail.word}.
            </>
          )}
        </>
      );
    case "deferred":
      return <Deferral word={word} target={target} />;
    default: {
      const exhaustive: never = word;
      throw new Error(`unreachable word outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * A word the index already holds — on a Rhyme Key that is not this day's.
 *
 * ## Why it names the keys
 *
 * "It already has a reading that does not rhyme" leaves the editor watching a
 * word they were sure about do nothing. The engine *has* a pronunciation, and
 * that pronunciation is the whole of the disagreement, so the line says where
 * the index holds the word: each reading with the key it yields. A word can be
 * held more than once, and a reading with no stressed vowel yields no key at
 * all — said in words rather than shown as a blank, because a blank beside a
 * key reads as a rendering fault.
 *
 * ## Why there is a button, and why it records rather than fixes
 *
 * The editor is reading a third-party rhyme list in the next window and believes
 * the word rhymes anyway. That belief is worth exactly as much at 11pm as it is
 * in a judging pass, and nothing else on this screen can hold it: an add wrote
 * nothing, a Tier verdict is about a word that is already in the Puzzle, and a
 * demotion takes wordhood away rather than granting a reading. So the click
 * records a **Candidate** — the report, never the fix (CONTEXT.md) — into the
 * queue that already exists for exactly this claim.
 *
 * No pronunciation is offered, proposed or accepted anywhere here, and the
 * button's words are chosen so it cannot be read as offering one. Contradicting
 * a source that spoke is a different act from filling a gap where the sources
 * are silent, with different stakes and its own evidence requirements; it stays
 * a hand edit of `data/supplement.dict`, made against the queue rather than from
 * this screen.
 *
 * ## Why it says "this pass" rather than "recorded"
 *
 * The queue cannot be read from here — it is write-only by design — so what the
 * screen actually knows is that *this tab* posted it. Saying so is the honest
 * version of the same reassurance, and it is why a reload puts the button back:
 * the record is in the queue, and the screen has simply stopped knowing it.
 */
function ReadsElsewhere({
  word,
  target,
  seed,
  disagreer,
}: {
  word: ReadsOnAnotherKeyOutcome;
  target: RhymeKey;
  seed: string | null;
  disagreer: Disagreer;
}) {
  const recorded = disagreer.recorded.has(word.word);
  const recording = disagreer.recording === word.word;

  return (
    <>
      already reads, and not on <code>{target}</code> — so this is a correction rather than an add,
      and nothing was written. Correcting a reading an upstream source gave is not something this
      tool does. The index holds it as{" "}
      <span className="editor-muted">
        {word.readings.map((reading, at) => (
          <span key={reading.phonemes.join(" ")}>
            {at > 0 && "  ·  "}
            {reading.phonemes.join(" ")} on{" "}
            {reading.key === null ? (
              <em>no key — the reading has no stressed vowel</em>
            ) : (
              <code>{reading.key}</code>
            )}
          </span>
        ))}
      </span>
      .{" "}
      {recorded ? (
        <span className="editor-disagree-recorded">
          Recorded this pass — the word, {seed} and <code>{target}</code> are in the
          supplement-candidate queue for a judging pass to rule on.
        </span>
      ) : (
        seed !== null && (
          <button
            type="button"
            className="editor-disagree"
            disabled={recording}
            onClick={() => {
              void disagreer.record(disagreementReport(word.word, word.readings, seed, target));
            }}
          >
            {recording ? "Recording…" : `It does rhyme with ${seed} — record that`}
          </button>
        )
      )}
    </>
  );
}

/**
 * Why one word was deferred.
 *
 * Each deferral names its own reason, which is the ticket's requirement and not
 * a nicety: a missing agent and a reading that failed verification are the same
 * "no reading written" to the file and completely different facts to the editor.
 * The first is a tooling problem to fix and retry; the second is a word the
 * composition genuinely cannot reach, and the proposal is shown so the miss is
 * inspectable rather than merely counted.
 */
function Deferral({ word, target }: { word: DeferredOutcome; target: RhymeKey }) {
  if (word.reason === "agent-unavailable") {
    return (
      <>
        deferred: no compound split reached <code>{target}</code> and the agent did not answer.
        Recorded in <code>data/deferred-readings.jsonl</code> for a later pass.
      </>
    );
  }
  return (
    <>
      deferred: no compound split reached <code>{target}</code>, and the agent proposed{" "}
      <code>{word.proposed?.join(" ")}</code>, which does not. Recorded in{" "}
      <code>data/deferred-readings.jsonl</code> for a later pass.
    </>
  );
}
