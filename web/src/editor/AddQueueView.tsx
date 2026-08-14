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
 * The key is shown but never typed. A word typed here is aimed at the day's own
 * Rhyme Key, resolved from `data/schedule.json` by the endpoint; showing it is
 * how the editor can *check* the aim, and there is deliberately no control that
 * changes it. A queue raised from the Candidate Queue is aimed at the key the
 * Candidate carries instead (#178) — still not a key anyone typed, and the
 * heading names whichever of the two the standing queue actually holds.
 *
 * The one gesture here that is not an add is `ReadsElsewhere`, which has its own
 * file: a word the index turns out to hold on another key, reported with the
 * keys it is held on, and offered a single click that records the disagreement
 * as a Candidate (#163). It writes no reading and proposes none — see that
 * module for why the two acts are kept apart.
 */

import { useState } from "react";
import type { AddTarget, DeferredOutcome, WordOutcome } from "./addOutcome.ts";
import type { RhymeKey } from "../../../src/phonology.ts";
import { MAX_QUEUED_WORDS, aimClash, aimHeldFor, type AddSubmitResult } from "./add.ts";
import { failureFor } from "./disagreement.ts";
import { ReadsElsewhere } from "./ReadsElsewhere.tsx";
import { pendingWork, type EditorStatus } from "./status.ts";
import type { Adder } from "./useAdder.ts";
import type { Disagreer } from "./useDisagreement.ts";
import type { Corrector } from "./useCorrector.ts";
import { CorrectionPanel } from "./CorrectionView.tsx";
import { honestReading } from "./correction.ts";

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
  corrector,
  status,
}: {
  date: string;
  rhymeKey: RhymeKey;
  adder: Adder;
  /** Recording a disagreement over a word the index holds on another key. */
  disagreer: Disagreer;
  /**
   * Approving a proposal the agent made and verification refused — the word's
   * **honest reading** (#180). It reaches this file rather than only the
   * Candidate Queue's because a failed-verification proposal is produced *here*,
   * by a Submit, and it is the same branch of the same outcome union: one card,
   * offered wherever the proposal turns up.
   */
  corrector?: Corrector;
  /** The repository's state, for the half of Submit's rule that is not the queue. */
  status: EditorStatus | null;
}) {
  const [typed, setTyped] = useState("");
  const { queue, submitting } = adder;
  // Two questions, and they part company on a queue raised from the Candidate
  // Queue. `takes` is whether a word typed *here* could join the standing queue
  // at all — false for a queue aimed at another day and for one aimed at a Rhyme
  // Key — and it is what shuts the entry and says why. `held` is the narrower
  // one: whether Submit would replace the screen with a day the editor is not
  // looking at. A key-aimed queue is held by neither day, which is what makes it
  // submittable from wherever the editor happens to be standing.
  const takes = aimClash(adder.aim, { kind: "day", date });
  const held = aimHeldFor(adder.aim, date);

  const queueTyped = () => {
    adder.queueWord(typed, { kind: "day", date });
    // Cleared unconditionally, including on a refusal. The refusal names the
    // word it refused, so the field is not where the editor reads what went
    // wrong, and leaving a rejected word in it means the next word is typed
    // onto the end of it.
    setTyped("");
  };

  return (
    <section className="editor-add">
      {/* The key the heading names is the queue's own when it has one, and the
          day's otherwise. They differ only for a queue raised from the Candidate
          Queue, and that is exactly when a heading reading "aimed at" the day's
          key would be saying something untrue about the words underneath it. */}
      <h3>
        Add missing words{" "}
        <span className="editor-muted">
          aimed at <code>{adder.aim?.kind === "key" ? adder.aim.rhymeKey : rhymeKey}</code>
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
            // Shut while a queue aimed elsewhere is standing, so the one
            // sentence explaining that is the only thing on screen saying it —
            // typing into a field that refuses every word with the same message
            // is the same message twice. `queueWord` refuses anyway.
            disabled={submitting || takes !== null}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="editor-add-queue"
          disabled={submitting || typed === "" || takes !== null}
        >
          Queue
        </button>
      </form>

      {/* Superseded by the held sentence rather than shown beside it. A refusal
          is about the last word typed, and the entry is shut while a queue is
          held — so anything still standing here is from the day the editor has
          just left, and reads as a second complaint about the day they are on. */}
      {adder.error !== null && takes === null && (
        <p className="editor-add-refused">{adder.error}</p>
      )}

      {/* Above the queue, not below it: this sentence is the reason no word
          typed here can join the words under it, and a reader who meets the
          list first has already reached for the field. */}
      {takes !== null && <p className="editor-add-held">{takes}</p>}

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
          // Disabled too on a queue typed against another day — `held`, not
          // `takes`: a queue raised from the Candidate Queue carries its own
          // Rhyme Key and is submittable from wherever the editor is standing,
          // which is the whole point of naming the key outright. That rule is
          // not enforced at the endpoint, because the endpoint cannot see it:
          // a Submit from the wrong day is a perfectly well-formed request.
          // `submit` checks it again instead, so it is not a rule only a button
          // enforces.
          disabled={!pendingWork(queue.length, status) || submitting || held !== null}
          onClick={() => void adder.submit(date)}
        >
          {submitting ? "Submitting…" : submitLabel(queue.length)}
        </button>
        {submitting && <InFlight count={queue.length} elapsedMs={adder.elapsedMs} />}
      </div>

      {adder.submitError !== null && <p className="editor-write-failed">{adder.submitError}</p>}

      {adder.result !== null && (
        <Submitted result={adder.result} disagreer={disagreer} corrector={corrector} />
      )}
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
function Submitted({
  result,
  disagreer,
  corrector,
}: {
  result: AddSubmitResult;
  disagreer: Disagreer;
  corrector?: Corrector;
}) {
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
  // A standing failure belongs to the Puzzle it was posted against, and this
  // readout names the one on screen. An empty Submit aimed at nothing has no
  // Seed Word, and no disagreement can have been posted from it either.
  const standingFailure = failureFor(disagreer.failure, outcome?.seed ?? null);

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
          about to fail the same way.

          Shown only while the readout under it is still the one the failed post
          was made from. A failure held as a bare sentence outlived what it was
          about — record on one day, fail, submit a batch on another, and the
          banner was still standing over a readout it had nothing to do with. */}
      {standingFailure !== null && (
        <p className="editor-write-failed">
          {standingFailure} <strong>Nothing was recorded</strong> — the disagreement is still only
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
                aim={outcome}
                disagreer={disagreer}
                corrector={corrector}
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
  aim,
  disagreer,
  corrector,
}: {
  word: WordOutcome;
  /**
   * What the batch was aimed at — the Rhyme Key and, when a scheduled day
   * supplied it, the Seed Word — taken from the outcome itself rather than from
   * the day on screen. The two part company the moment an editor checks a
   * neighbouring day with a Submit's readout still standing, and a Candidate
   * naming the wrong Puzzle would look exactly as correct as one naming the
   * right one.
   */
  aim: AddTarget;
  disagreer: Disagreer;
  corrector?: Corrector;
}) {
  const { target } = aim;
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
      return <ReadsElsewhere word={word} aim={aim} disagreer={disagreer} />;
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
      return <Deferral word={word} target={target} corrector={corrector} />;
    default: {
      const exhaustive: never = word;
      throw new Error(`unreachable word outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
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
function Deferral({
  word,
  target,
  corrector,
}: {
  word: DeferredOutcome;
  target: RhymeKey;
  corrector?: Corrector;
}) {
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
      {/* And offered, because a proposal that failed verification is not only a
          miss: it may be the word's **honest reading**, and writing it is what
          makes the player be told "doesn't rhyme" rather than "not a word we
          know" (#176). The same card the Candidate Queue's correction draws,
          with nothing to join to — the engine reads this word not at all. */}
      {corrector !== undefined && word.proposed !== null && (
        <CorrectionPanel
          word={word.word}
          rhymeKey={target}
          current={[]}
          corrector={corrector}
          standing={honestReading(word.word, target, word.proposed)}
        />
      )}
    </>
  );
}
