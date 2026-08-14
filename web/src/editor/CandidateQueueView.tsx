/**
 * The Candidate Queue, rendered. Two surfaces over one readout: the whole queue
 * grouped by Rhyme Key, and the panel for the day the editor is already reading
 * (#177) — plus the queue's second section, the readings the add path asked an
 * agent for and did not get (#181), which hangs under the whole-queue surface
 * because it is aimed at Rhyme Keys and belongs to no date at all.
 *
 * **This file decides nothing.** Every state on the screen was derived in
 * `scripts/editorCandidates.ts` and arrived over the wire already resolved; the
 * only choice made here is which card a state draws, and even that is
 * `cardFor`'s (`dayCandidates.ts`), so the day panel and the whole-queue list
 * cannot draw one Candidate two ways. If a resolved check or an
 * add-versus-correct determination ever appears in this file, the shape has gone
 * wrong.
 *
 * **The gestures are handed in, never built here.** Slice 2 attaches two acts to
 * the cards — the one-gesture add and the three-way Decline (#178) — and both
 * arrive as callbacks, so this file still decides nothing: which act a Candidate
 * offers is `offersAdd` and `isOutstanding`'s, what each Decline writes and what
 * it costs is `decline.ts`'s, and where the write goes is the hook's.
 *
 * Both are **optional** and both are offered on both surfaces. The add is aimed
 * at a Rhyme Key, and a Candidate carries its own — the key its Appeal was
 * recorded against — so the whole-queue list needs no day to raise one from, and
 * the group with no scheduled day behind it (most of the queue) is addable like
 * any other. What differs between the two surfaces is only which aim the screen
 * hands the add: the day panel keeps the day-derived one it already had, and the
 * list above aims at the Candidate's key. See `EditorApp`.
 */

import { useState } from "react";
import { isOutstanding, type ReadCandidate } from "../../../scripts/editorCandidates.ts";
import type { CandidateQueueReadout, CandidateGroup } from "../../../scripts/editorCandidates.ts";
import type { DeferredSection, ReadDeferral } from "../../../scripts/editorDeferred.ts";
import type { Pronunciation } from "../../../src/phonology.ts";
import {
  DECLINE_CHOICES,
  DECLINE_CONSEQUENCE,
  DECLINE_LABEL,
  declineWrites,
  type DeclineChoice,
} from "./decline.ts";
import { candidatesForDay, cardFor, evidenceFor, offersAdd } from "./dayCandidates.ts";
import { deferredReadings, proposalFor } from "./deferredReadings.ts";
import { CorrectionPanel } from "./CorrectionView.tsx";
import type { Corrector } from "./useCorrector.ts";

/**
 * The acts a card can offer, as the screen hands them down.
 *
 * One object rather than two props threaded through four components, and every
 * field optional so that a surface which cannot offer an act simply does not
 * pass it — which is how the whole-queue list has no add without a second
 * component knowing why.
 */
export interface CandidateActs {
  /**
   * Queue this Candidate's word as an add, prefilled. The whole Candidate
   * rather than its word, because what the add is aimed at is the Candidate's
   * own Rhyme Key on the list above and the day's on the panel below, and only
   * the screen assembling the act knows which of the two it is offering.
   */
  onAdd?: (candidate: ReadCandidate) => void;
  /** Rule on the Candidate. The choice decides which of the two files is written. */
  onDecline?: (candidate: ReadCandidate, choice: DeclineChoice) => void;
  /** The word a write is in flight for, so its card can say so. */
  writing?: string | null;
  /**
   * The correction gesture, for the one card that offers it (#180). Optional
   * like the other two, so a surface that cannot offer it simply does not pass
   * one — and it is the whole hook rather than two callbacks because the
   * proposal between the ask and the approval is state the card renders and
   * nothing else holds.
   */
  corrector?: Corrector;
  /**
   * Try the add again for a word the agent could not be reached for (#181).
   *
   * The whole deferral rather than its word, for `onAdd`'s reason: what the
   * retry is aimed at is the Rhyme Key the *first* attempt was aimed at, which
   * the record carries and no screen should be re-deriving from whichever day
   * happens to be showing.
   */
  onRetry?: (deferral: ReadDeferral) => void;
}

/**
 * The whole queue, at the top of the pass beside the status panel.
 *
 * Drawn even when it is empty, because an empty queue and an unpulled one look
 * identical and only one of them is good news — which is what `newest` is for.
 */
export function CandidateQueueView({
  queue,
  error,
  loading,
  acts,
}: {
  queue: CandidateQueueReadout | null;
  error: string | null;
  loading: boolean;
  /** The full set: an add up here is aimed at the Candidate's own Rhyme Key. */
  acts: CandidateActs;
}) {
  return (
    <section className="editor-queue">
      <h2>Candidate Queue</h2>

      {error !== null && <p className="editor-queue-failed">{error}</p>}

      {queue === null && error === null && (
        <p className="editor-muted">{loading ? "Reading the queue…" : "No queue yet."}</p>
      )}

      {queue !== null && (
        <>
          <p className="editor-queue-lede">
            {queue.outstanding} of {queue.total} outstanding, over {queue.groups.length} Rhyme{" "}
            {queue.groups.length === 1 ? "Key" : "Keys"}. <Newest newest={queue.newest} />
          </p>

          {queue.groups.map((group) => (
            <QueueGroup key={group.rhymeKey} group={group} acts={acts} />
          ))}

          {/* The second section, under the Candidates and inside the same
              panel: it is part of the Candidate Queue rather than a screen of
              its own (CONTEXT.md), and it is a shorter list about the tool's own
              failures rather than about what players sent. */}
          <DeferredReadingsView section={deferredReadings(queue)} acts={acts} />
        </>
      )}
    </section>
  );
}

/**
 * The readings the add path asked an agent for and did not get (#181).
 *
 * **Drawn even when it is empty**, and that is the live case: the file is zero
 * bytes today, so the heading and one muted sentence is what an editor sees. An
 * empty section is the good news — every add the pass asked for got a reading —
 * and a section that vanished when it was empty would be indistinguishable from
 * one that had never been read back at all, which is the silence this whole
 * slice exists to end.
 *
 * **This component decides nothing.** Which state a deferral is in was derived
 * in Node, how many of them still want the editor is counted there too
 * (`isDeferralOutstanding`), and what an approve card is drawn over is
 * `proposalFor`'s — all of them where a test can reach them.
 */
function DeferredReadingsView({
  section,
  acts,
}: {
  section: DeferredSection;
  acts: CandidateActs;
}) {
  return (
    <section className="editor-deferred">
      <h3>
        Readings the agent did not supply{" "}
        <span className="editor-muted">
          {section.entries.length === 0
            ? "— none"
            : `— ${section.outstanding} outstanding of ${section.entries.length}`}
        </span>
      </h3>

      {section.entries.length === 0 ? (
        <p className="editor-muted">
          Nothing deferred: every word the pass has asked an agent for came back with a reading it
          could take.
        </p>
      ) : (
        <ul className="editor-queue-list">
          {section.entries.map((deferral) => (
            <li key={`${deferral.word}-${deferral.rhymeKey}`}>
              <DeferralCardView deferral={deferral} acts={acts} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One deferred word: what happened to it, and the two acts that answer the two
 * things that can have happened.
 *
 * **The retry is the existing add path**, prefilled and aimed at the Rhyme Key
 * the first attempt was aimed at. It queues rather than writes, exactly as the
 * Candidate add does and for the same reason (#161): the point of the gesture is
 * that a word whose only problem was a subprocess failing is not retyped.
 *
 * It is offered on `unreached` **and nowhere else**. An agent that has already
 * answered must not be asked again (#180): the second answer would be a
 * different reading, and the first is the one the editor is being asked to
 * judge — so a retry button beside a standing proposal invites exactly the thing
 * `honestReading` exists to prevent. A deferral with a proposal on it has one
 * act, and it is the card.
 *
 * **The approve card is #180's**, handed the proposal the add path already made
 * rather than asking for a new one — which is why no `ask` is passed. Asking
 * again would spend another minute of agent time to get a *different* reading
 * and throw away the one the editor is being invited to judge. The engine reads
 * this word not at all, which is why `current` is empty and why `correctionModes`
 * offers only `replace`: there is no second pronunciation to join to.
 */
function DeferralCardView({
  deferral,
  acts,
}: {
  deferral: ReadDeferral;
  acts: CandidateActs;
}) {
  const proposal = proposalFor(deferral);
  const retry = acts.onRetry;

  return (
    <div className={`editor-deferral editor-deferral-${deferral.state}`}>
      <span className="editor-candidate-word">{deferral.word}</span>
      <span className="editor-candidate-state">{DEFERRAL_SENTENCE[deferral.state]}</span>
      <span className="editor-muted">
        aimed at <code>{deferral.rhymeKey}</code>, deferred{" "}
        {deferral.record.timestamp.slice(0, 10)}
      </span>

      {deferral.state === "answered" && (
        <span className="editor-candidate-evidence">
          {deferral.readings.map((reading) => (
            <code key={reading.phonemes.join(" ")}>
              {say(reading.phonemes)} → {reading.key ?? "unstressed"}
            </code>
          ))}
        </span>
      )}

      {proposal !== null && acts.corrector !== undefined && (
        <CorrectionPanel
          word={deferral.word}
          rhymeKey={deferral.rhymeKey}
          current={[]}
          corrector={acts.corrector}
          standing={proposal}
        />
      )}

      {retry !== undefined && deferral.state === "unreached" && (
        <div className="editor-candidate-acts">
          <button type="button" className="editor-deferral-retry" onClick={() => retry(deferral)}>
            Queue {deferral.word} again
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What each state means, in the editor's terms rather than the union's — a
 * `Record` over the closed set, for `STATE_SENTENCE`'s reason: a fourth state
 * cannot be added to the union without this table refusing to compile.
 */
const DEFERRAL_SENTENCE: Record<ReadDeferral["state"], string> = {
  answered: "the engine reads this word now — nothing to do",
  unreached: "the agent could not be reached — nothing was proposed",
  proposed: "the agent's reading missed the Rhyme Key — judge it below",
};

/**
 * The queue's own newest timestamp, said in full.
 *
 * The pull from R2 stays a CLI step run before the dev server (#176), so this is
 * the only way the screen can tell an editor that the list in front of them is
 * behind: a queue nobody has pulled looks *empty*, which reads as "no work" when
 * it means "no data".
 */
function Newest({ newest }: { newest: string | null }) {
  if (newest === null) {
    return (
      <span className="editor-queue-stale">
        Nothing on the queue at all — run <code>npm run pull:appeals</code> if that is a surprise.
      </span>
    );
  }
  return (
    <span className="editor-muted">
      Newest Candidate {newest.slice(0, 10)}; run <code>npm run pull:appeals</code> for anything
      since.
    </span>
  );
}

/** One Rhyme Key's Candidates, and the day the schedule holds for that key. */
function QueueGroup({ group, acts }: { group: CandidateGroup; acts: CandidateActs }) {
  return (
    <article className="editor-queue-group">
      <h3>
        <code>{group.rhymeKey}</code>{" "}
        <span className="editor-muted">
          {group.outstanding === 0
            ? "nothing outstanding"
            : `${group.outstanding} outstanding of ${group.candidates.length}`}
        </span>
      </h3>

      <p className="editor-queue-day">
        {group.day === null ? (
          // The common case, and the one a day-shaped surface would have lost:
          // an Appeal raised in Free Play carries a Seed the schedule never had.
          <span className="editor-queue-undated">No scheduled day holds this Rhyme Key.</span>
        ) : (
          <>
            {group.day.date} <span className="editor-muted">{group.day.weekday}</span> · Seed{" "}
            <strong>{group.day.seed}</strong>
          </>
        )}
        {" · "}
        Appealed against {group.seedWords.join(", ")}
      </p>

      <ul className="editor-queue-list">
        {group.candidates.map((candidate) => (
          <li key={`${candidate.word}-${candidate.candidate.timestamp}`}>
            <CandidateCardView candidate={candidate} acts={acts} />
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The day's own Candidates, inside the scheduled-day case and nowhere else —
 * the other two readouts have no Rhyme Key to select on.
 *
 * It draws nothing at all when the day's key holds no Candidates, which is 255
 * days out of 260. A panel that appeared on every day to say "none" would be a
 * heading the editor learns to skip, and the whole queue is one panel up.
 */
export function DayCandidatesView({
  queue,
  rhymeKey,
  acts,
}: {
  queue: CandidateQueueReadout | null;
  rhymeKey: string;
  /** The full set here: this panel knows a day, so the add has somewhere to aim. */
  acts: CandidateActs;
}) {
  const day = candidatesForDay(queue, rhymeKey);
  if (day.all.length === 0) return null;

  return (
    <section className="editor-queue-day-panel">
      <h3>
        Candidates on this Rhyme Key{" "}
        <span className="editor-muted">
          {day.outstanding.length === 0
            ? "— all settled"
            : `— ${day.outstanding.length} outstanding of ${day.all.length}`}
        </span>
      </h3>

      {/* Worth saying whenever it is true: the panel is selected by Rhyme Key,
          so a Candidate raised on another Puzzle entirely can land here, and an
          editor reading the day's Seed Word would otherwise wonder why. */}
      {day.seedWords.length > 1 && (
        <p className="editor-queue-note">
          Raised against {day.seedWords.join(" and ")} — the same rhyme family, judged together.
        </p>
      )}

      <ul className="editor-queue-list">
        {day.all.map((candidate) => (
          <li key={`${candidate.word}-${candidate.candidate.timestamp}`}>
            <CandidateCardView candidate={candidate} acts={acts} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the editor is told about one Candidate — its state and its own evidence —
 * and what they can do about it.
 *
 * The acts sit below the evidence rather than beside the word, because the
 * evidence is what the ruling is made *from*: a card is read top to bottom and
 * the buttons are the end of that sentence.
 */
function CandidateCardView({
  candidate,
  acts,
}: {
  candidate: ReadCandidate;
  acts: CandidateActs;
}) {
  return (
    <div className={`editor-candidate editor-candidate-${cardFor(candidate)}`}>
      <span className="editor-candidate-word">{candidate.word}</span>
      <span className="editor-candidate-state">{STATE_SENTENCE[candidate.state]}</span>
      <CandidateEvidence candidate={candidate} />
      {/* The correction, on the one card whose word the engine already reads
          (#180). Dispatched on `cardFor` rather than on the state directly, so
          the card a Candidate draws is decided in one place and this file goes
          on deciding nothing. */}
      {cardFor(candidate) === "correction" && acts.corrector !== undefined && (
        <CorrectionPanel
          word={candidate.word}
          rhymeKey={candidate.candidate.seedRhymeKey}
          current={evidenceFor(candidate).readings}
          corrector={acts.corrector}
          ask={`Ask an agent to correct ${candidate.word}`}
        />
      )}
      <CandidateActsView candidate={candidate} acts={acts} />
    </div>
  );
}

/**
 * The two acts, and the second click the Decline takes.
 *
 * **The add is one click.** The word is on the screen already, so the gesture is
 * the whole of it: no field, no confirmation, nothing retyped. It queues rather
 * than writes, which is not a hedge — it is the existing add path, whose queue
 * costs nothing until Submit and lets a word be taken back out before it costs
 * anything (#161). A Candidate-raised add joins the same batch as the words the
 * editor typed and is submitted, judged, verified and written with them.
 *
 * **The Decline is two**, and the second click is the point of the first. The
 * three rulings do different things — two of them take a word's wordhood on
 * every day — so the menu exists to put each one's consequence in front of the
 * editor *before* it is taken rather than in the banner afterwards. It is the
 * shape `DemoteMenu` uses in `DayReadoutView.tsx`, for the same reason.
 *
 * It is offered to every Candidate that is still `isOutstanding`, and all three
 * rulings are reachable from every one of those states on purpose: `is-a-name`
 * is the obvious Proper Noun, but a name the names data does not hold reads
 * `addable` and is exactly the case the demotion list exists for, and any state
 * can turn out to be junk or to have been rejected for the right reason all
 * along. Which of the three the editor picks is a judgement about the word, and
 * the queue has no basis for making it for them. A settled Candidate — resolved,
 * or already declined — is offered nothing: there is no un-decline anywhere in
 * the tool, and a Candidate the engine now accepts is not being rejected, so
 * there is no rejection left to agree with.
 */
function CandidateActsView({
  candidate,
  acts,
}: {
  candidate: ReadCandidate;
  acts: CandidateActs;
}) {
  const [ruling, setRuling] = useState(false);
  const add = acts.onAdd;
  const decline = acts.onDecline;
  const canAdd = add !== undefined && offersAdd(candidate);
  const canDecline = decline !== undefined && isOutstanding(candidate);
  if (!canAdd && !canDecline) return null;

  const busy = acts.writing === candidate.word;

  return (
    <div className="editor-candidate-acts">
      {canAdd && (
        <button
          type="button"
          className="editor-candidate-add"
          disabled={busy}
          onClick={() => add!(candidate)}
        >
          Queue {candidate.word} as an add
        </button>
      )}

      {canDecline && !ruling && (
        <button
          type="button"
          className="editor-candidate-decline"
          disabled={busy}
          onClick={() => setRuling(true)}
        >
          {busy ? "Declining…" : "Decline…"}
        </button>
      )}

      {canDecline && ruling && (
        <div
          className="editor-candidate-rulings"
          role="group"
          aria-label={`Decline ${candidate.word}`}
        >
          <p className="editor-candidate-rulings-lede">
            Declining <strong>{candidate.word}</strong> against <code>{candidate.candidate.seedRhymeKey}</code>:
          </p>
          {DECLINE_CHOICES.map((choice) => (
            <p key={choice} className={`editor-candidate-ruling editor-candidate-ruling-${declineWrites(choice)}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRuling(false);
                  decline!(candidate, choice);
                }}
              >
                {DECLINE_LABEL[choice]}
              </button>{" "}
              <span className="editor-candidate-consequence">{DECLINE_CONSEQUENCE[choice]}</span>
            </p>
          ))}
          <button type="button" className="editor-candidate-ruling-cancel" onClick={() => setRuling(false)}>
            Leave it on the queue
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What each state means, in the editor's terms rather than the union's.
 *
 * A `Record` over the closed set rather than a `switch` with a default: a sixth
 * state cannot be added to the union without this table refusing to compile,
 * which is the shape `REJECTION_MESSAGE` uses for the same guarantee (ADR-0005).
 */
const STATE_SENTENCE: Record<ReadCandidate["state"], string> = {
  resolved: "rhymes now — nothing to do",
  declined: "declined for this Rhyme Key",
  "is-a-name": "a name — demote it",
  "needs-correction": "reads on another key — needs a correction",
  addable: "no reading the engine will take — an add",
};

/**
 * Each card shows the evidence its own case turns on and not the rest, which is
 * what keeps the screen readable at the point of judgement.
 *
 * **Which is which is `evidenceFor`'s** (`dayCandidates.ts`) and not this file's,
 * for `cardFor`'s reason and one more: "a correction card shows direct readings
 * and no relatives, a derivation card shows relatives and no direct reading" is
 * a rule the ticket states about the screen, and a rule that lives only inside
 * JSX is a rule no test can hold to account. This renders the three lists it is
 * handed and asks nothing about the state.
 */
function CandidateEvidence({ candidate }: { candidate: ReadCandidate }) {
  const { readings, relatives, composed } = evidenceFor(candidate);
  if (readings.length === 0 && relatives.length === 0 && composed === null) return null;

  // Only an `addable` card ever shows a reading with no wordhood behind it: a
  // word the pinned sources read on the target and the wordhood set does not
  // hold, which the supplement is the only layer that can grant (ADR-0009).
  const unknown = candidate.state === "addable";

  return (
    <span className="editor-candidate-evidence">
      {composed !== null && (
        <code>
          {composed.head.word} + {composed.tail.word} → {say(composed.phonemes)}
        </code>
      )}
      {relatives.map((relative) => (
        <code key={relative.word}>
          {relative.word} {relative.readings.map((r) => r.key ?? "—").join(", ")}
        </code>
      ))}
      {readings.map((reading) => (
        <code key={reading.phonemes.join(" ")}>
          {say(reading.phonemes)} → {reading.key ?? "unstressed"}
          {unknown ? " (no wordhood)" : ""}
        </code>
      ))}
    </span>
  );
}

function say(phonemes: Pronunciation): string {
  return phonemes.join(" ");
}
