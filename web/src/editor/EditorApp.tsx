/**
 * The editor's screen: the day, the one control that changes which day, the Tier
 * picker over the words on it, and the queue of words the read turned up as
 * missing — a read and the corrections it produces, which is what an Editor's
 * Pass is (ADR-0016).
 *
 * It opens on tomorrow — the endpoint's default, asked for by naming no date at
 * all — because tomorrow is the day an Editor's Pass is nearly always about.
 * Typing a date jumps there, including to a date the run does not cover, which
 * the readout answers by naming the run's edges.
 *
 * The picker's state is fetched **for the day the readout came back with**, not
 * for the date the editor typed: the opening request names no date at all, so
 * the browser does not know which day it is looking at until the readout says.
 * Keying off the readout also keeps the two halves of the screen from ever
 * describing different days, which is why `DayReadoutView` checks the two dates
 * again before it applies one to the other.
 *
 * The demote gesture is fetched once and not per day, unlike the picker: a
 * demotion takes a word's wordhood, which is a property of the word rather than
 * of a date, so the standing list is the same on every day the editor visits.
 *
 * The add queue is neither. It is not fetched at all — it lives in the browser
 * and costs nothing until Submit (#161) — and it is deliberately **not** reset
 * when the day changes, because a queue keyed to the day would be a queue lost
 * every time an editor checked a neighbouring day mid-pass. It does, though,
 * *remember what it is aimed at*: a day, whose Rhyme Key the endpoint resolves
 * from the date Submit sends, or a Rhyme Key a Candidate supplied outright. A
 * queue that forgot would take its aim from whichever day happened to be on
 * screen at the click and write Monday's words against Tuesday's family. A queue
 * aimed elsewhere is shown in full and cannot be added to — `aimClash`
 * (`web/src/editor/add.ts`) is that rule and argues for it — and a day-aimed one
 * cannot be submitted from another day either (`aimHeldFor`, same file).
 *
 * `show` is how Submit's re-read lands: the endpoint answers with the day read
 * off the index it has just rebuilt, and the readout is handed to the hook that
 * owns the day rather than kept a second time by the one that submitted.
 *
 * The status hook is about none of the three above — not the day, not the words
 * on it, not the queue beside them. It
 * is about the repository rather than a day — whether the built Rhyme Index is
 * stale, and whether the files the pass writes are committed (#162) — so it is
 * fetched once, refreshed when a write lands or the window is focused, and
 * never keyed to the date. It is drawn here, at the top, and passed down as far
 * as the add queue for the one rule that reads it: Submit is enabled by a stale
 * index as well as by a queued add.
 *
 * The disagreement recorder is the one hook whose writes are absent from that
 * status — deliberately. `WRITTEN_GROUPS` names the files the
 * pass is *accountable for committing*, and the supplement-candidate queue is
 * not one of them: it is gitignored with the rest of `data/`, it is judged
 * offline and pulled down rather than committed, and its deployed half writes to
 * R2 where there is no working tree to be dirty. Listing it would put a heading
 * on the status panel that could only ever read "ignored" — the state that panel
 * added specifically to be alarming (#162) — about a file whose being ignored is
 * correct. It is also why nothing here refreshes the status when a disagreement
 * lands: a recorded Candidate moves no figure, no word list and no file the
 * screen reports on.
 */

import { useEffect, useState } from "react";
import type { ReadCandidate } from "../../../scripts/editorCandidates.ts";
import { useAdder } from "./useAdder.ts";
import { useCandidateQueue } from "./useCandidateQueue.ts";
import { useCorrector } from "./useCorrector.ts";
import { useDayReadout } from "./useDayReadout.ts";
import { useDecliner } from "./useDecliner.ts";
import { useDemoter } from "./useDemoter.ts";
import { useDisagreement } from "./useDisagreement.ts";
import { useEditorStatus } from "./useEditorStatus.ts";
import { useTierPicker } from "./useTierPicker.ts";
import { isDemotionDecline, type DeclineChoice } from "./decline.ts";
import { CandidateQueueView, type CandidateActs } from "./CandidateQueueView.tsx";
import { DayReadoutView } from "./DayReadoutView.tsx";
import { StatusView } from "./StatusView.tsx";

export function EditorApp() {
  const { readout, loading, error, goTo, show } = useDayReadout();
  // The day on screen, which is the readout's own — the three hooks below are
  // all day-scoped against it, so they read it from one place.
  const day = readout?.date ?? null;
  const picker = useTierPicker(day);
  const demoter = useDemoter(day);
  const decliner = useDecliner(day);
  const adder = useAdder(show, day);
  const disagreer = useDisagreement();
  const { status, error: statusError, refresh } = useEditorStatus();
  // Not day-scoped, like the demoter and unlike the picker: the queue is grouped
  // by Rhyme Key and most of it belongs to no scheduled day at all, so there is
  // no date to fetch it for. The day panel selects out of this one readout.
  const candidates = useCandidateQueue();
  // Not day-scoped either, and for a stronger reason than the queue's: a
  // correction changes the word on *every* day (#180), so scoping it to the one
  // on screen would attach a fact about the whole run to a date it happens to
  // have been made from.
  const corrector = useCorrector();

  // The status and the queue are both refreshed by **observing** that a write
  // happened, rather than by callbacks threaded through four hooks. Each of
  // these five values is set only on a write the file accepted —
  // `picker.recorded` on a Tier verdict, `demoter.recorded` on a demotion,
  // `adder.result` on a Submit, `decliner.recorded` on a Decline,
  // `corrector.result` on an approved correction — and each is a
  // fresh object every time, so two identical verdicts in a row are still two
  // refreshes. A callback per hook would be a second announcement of a fact each
  // hook already publishes, and one more thing for a sixth write route to
  // remember to call.
  //
  // A *failed* write sets none of them, and correctly triggers nothing: what it
  // changed on disk is nothing.
  //
  // One observation and not two, because the five writes that move the status
  // are the same five that move the queue, and a second effect over the same
  // condition would be a second place to forget the fifth. What each refresh is
  // *for* differs, and both reasons are worth stating:
  //
  // - **The status.** Every one of the five writes a file `WRITTEN_GROUPS` names
  //   and the panel reports on. A Decline is the one whose case is narrower: it
  //   cannot make the built Rhyme Index stale, since the build never opens
  //   `data/declines.txt`, so the index line cannot have moved — but the file is
  //   hand-written, committed and derived from nothing, and a ruling that has
  //   just landed has just made it uncommitted.
  // - **The queue.** Every state on it is derived from `data/` on each read, so
  //   an add, a demotion or a Tier verdict can retire a Candidate without anyone
  //   ruling on it, and a Decline is the one write that settles one directly. A
  //   queue held from mount would go on presenting work the editor has just done.
  const refreshQueue = candidates.refresh;
  useEffect(() => {
    if (
      picker.recorded === null &&
      demoter.recorded === null &&
      adder.result === null &&
      decliner.recorded === null &&
      corrector.result === null
    ) {
      return;
    }
    refresh();
    refreshQueue();
  }, [
    picker.recorded,
    demoter.recorded,
    adder.result,
    decliner.recorded,
    corrector.result,
    refresh,
    refreshQueue,
  ]);

  // The two acts the Candidate cards offer, assembled here because here is where
  // both hooks they reach are held. Neither is a new write path: the add is the
  // add queue's own `queueWord` with the word prefilled and its provenance
  // recorded, and two of the three Declines are the demote gesture's own
  // `demote`. `isDemotionDecline` is what routes them, and it is `decline.ts`'s
  // rule rather than a condition spelled out here — a fourth choice added to the
  // union cannot then be silently written nowhere.
  const declineCandidate = (candidate: ReadCandidate, choice: DeclineChoice) => {
    if (isDemotionDecline(choice)) {
      // The existing demote gesture, reached with the word prefilled. Nothing is
      // written to the Declines file for it: one demotion path in the tool, and a
      // demoted name is settled by the editor's separate `reason-is-correct`
      // ruling if they want it off the queue as well as out of the game (#178).
      void demoter.demote(candidate.word, choice);
      return;
    }
    void decliner.decline(candidate.word, candidate.candidate.seedRhymeKey);
  };

  /**
   * The whole-queue list. An add raised here is aimed at the **Candidate's own
   * Rhyme Key**, which is the one thing that makes the gesture reach the queue
   * rather than the sliver of it the schedule happens to hold: most Candidates
   * belong to no scheduled day at all (#176), so an add that could only take its
   * aim from a date would never be offered to the largest group on the screen.
   * The key is not the browser's guess about anything — it is the key the
   * player's Appeal was recorded against, carried on the Candidate.
   */
  const queueActs: CandidateActs = {
    onAdd: (candidate) =>
      adder.queueWord(candidate.word, { kind: "key", rhymeKey: candidate.candidate.seedRhymeKey }, true),
    onDecline: declineCandidate,
    writing: decliner.writing ?? demoter.writing,
    // The correction, on the one card that offers it. The whole hook rather than
    // a callback, because the proposal between the ask and the approval is state
    // the card renders and nothing on disk holds — asking writes nothing, which
    // is the whole point of the two-step (ADR-0017).
    corrector,
    // The retry, on the queue's second section (#181). It is `queueWord` again —
    // the same add path, aimed at the Rhyme Key the deferred attempt was aimed
    // at — because "retry" means running the existing add for that word, never a
    // write path of its own.
    //
    // Deliberately **not** flagged as raised from a Candidate, unlike the add
    // above: a deferred reading is the editor's own add that a subprocess failed
    // on, and nobody Appealed it. The provenance comment that flag writes into
    // `data/supplement.dict` says a player asked for the word (#178), and it
    // would be saying something untrue here.
    onRetry: (deferral) =>
      adder.queueWord(deferral.word, { kind: "key", rhymeKey: deferral.rhymeKey }),
  };

  /**
   * The day panel, whose add keeps the **day-derived** aim it already had. The
   * panel is selected by the day's own Rhyme Key, so the two aims name the same
   * family; taking it from the date leaves the endpoint resolving the key from
   * `data/schedule.json` as it does for every word the editor types, and lets a
   * Candidate raised here join the same queue as those words rather than
   * clashing with it.
   */
  const dayActs: CandidateActs = {
    ...queueActs,
    onAdd: (candidate) => {
      if (day !== null) adder.queueWord(candidate.word, { kind: "day", date: day }, true);
    },
  };
  // The control shows the date the editor last entered in full, and otherwise
  // the day on screen — which is how the endpoint's choice of tomorrow becomes
  // visible without the browser having decided it.
  //
  // A whole date typed by the editor has to win, and that is not a nicety: a
  // date field is entered one segment at a time and every complete date it
  // passes through fires a change, so a value driven by the readout snaps the
  // remaining segments back to the day that just arrived and the date lands
  // somewhere nobody asked for — typing 2027-06-01 over 2026-08-09 produced
  // 2026-07-09. An incomplete entry reads as empty, and falls back rather than
  // sticking, so a half-typed date cannot leave the control blank.
  const [typed, setTyped] = useState("");

  return (
    <main className="editor">
      <header className="editor-head">
        <h1>Editor’s Pass</h1>
        <label className="editor-jump">
          Day
          <input
            type="date"
            value={typed === "" ? readout?.date ?? "" : typed}
            onChange={(event) => {
              setTyped(event.target.value);
              // A cleared or half-entered field is not a jump to nowhere; the
              // day on screen stays until a whole date has been entered.
              if (event.target.value !== "") goTo(event.target.value);
            }}
          />
        </label>
      </header>

      {error !== null && <section className="editor-alarm">{error}</section>}

      {/* Above the day, and outside the block that dims while a day is fetched:
          neither fact it shows is about the date on screen, so dimming it on a
          jump would say it had gone stale when nothing about it had moved. */}
      <StatusView status={status} error={statusError} />

      {/* Beside the status and outside the day's block, for the same reason: a
          Candidate is aimed at a Rhyme Key rather than at a date, and most of
          the queue belongs to no scheduled day at all. Dimming it on a jump
          would say it had gone stale when nothing about it had moved. The acts
          on it are the reason that holds for the *gestures* too — an add raised
          here aims at the Candidate's key, so nothing about it is a fact about
          the day on screen. */}
      <CandidateQueueView
        queue={candidates.queue}
        error={candidates.error}
        loading={candidates.loading}
        acts={queueActs}
      />

      {/* A refused ruling, said once and near the queue it was made on. Quieter
          than the demote banner in `DayReadoutView` on purpose: a Decline that
          did not reach the file changes nothing at all, and its whole cost is
          that the Candidate is still on the queue — which is where it is. */}
      {decliner.error !== null && <p className="editor-write-failed">{decliner.error}</p>}

      {/* The previous day stays on screen while the next one is fetched, dimmed
          rather than replaced: a blank screen between two days makes a jump feel
          like a failure, and a day's readout arrives in milliseconds. */}
      {readout !== null && (
        <div className={loading ? "editor-body editor-loading" : "editor-body"}>
          <DayReadoutView
            readout={readout}
            picker={picker}
            demoter={demoter}
            adder={adder}
            disagreer={disagreer}
            status={status}
            candidates={candidates.queue}
            candidateActs={dayActs}
          />
        </div>
      )}

      {readout === null && loading && <p className="editor-muted">Reading the day…</p>}
    </main>
  );
}
