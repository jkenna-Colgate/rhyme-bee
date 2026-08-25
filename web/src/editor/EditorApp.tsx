/**
 * The editor's screen: the day, the one control that changes which day, the Tier
 * picker over the words on it, and the queue of words the read turned up as
 * missing — a read and the corrections it produces, which is what an Editor's
 * Pass is (ADR-0016).
 *
 * The four panels are tabs rather than a stack (`EditorTabs`), opening on the
 * day. Every hook is held here regardless of which tab is showing, so a switch
 * refetches nothing and loses nothing; the date control and the banners that
 * belong to no single panel stay above the strip.
 *
 * The pasted rhyme list (#188) is the one panel that holds something the editor
 * typed rather than something a route answered with, which is precisely why it
 * is held up here with the rest: a paste kept inside its own panel would be lost
 * on the first switch back to the day, since `TabPanel` unmounts what is not
 * showing. The facts its residue is split on (#189) are held with it, for the
 * same reason and one more — they are what makes the split, and a lookup the
 * editor had to repeat after every glance at the day would not be pressed twice.
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
 * never keyed to the date. It gets a tab of its own, and is *also* passed down
 * as far as the add queue for the one rule that reads it: Submit is enabled by a
 * stale index as well as by a queued add — which is why the add queue does not
 * go quiet about it while the editor is looking at the day.
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

import { useEffect, useMemo, useState } from "react";
import type { ReadCandidate } from "../../../scripts/editorCandidates.ts";
import { useAdder } from "./useAdder.ts";
import { useCandidateQueue } from "./useCandidateQueue.ts";
import { useCorrector } from "./useCorrector.ts";
import { useDayReadout } from "./useDayReadout.ts";
import { useDecliner } from "./useDecliner.ts";
import { useDemoter } from "./useDemoter.ts";
import { useDisagreement } from "./useDisagreement.ts";
import { useEditorStatus } from "./useEditorStatus.ts";
import { usePastedList } from "./usePastedList.ts";
import { useTierPicker } from "./useTierPicker.ts";
import { isDemotionDecline, type DeclineChoice } from "./decline.ts";
import { demotedWords } from "./demote.ts";
import { CandidateQueueView, type CandidateActs } from "./CandidateQueueView.tsx";
import { DayReadoutView, DemoteBanner } from "./DayReadoutView.tsx";
import { EditorTabs, TabPanel, type EditorTab } from "./EditorTabs.tsx";
import { PastedListView } from "./PastedListView.tsx";
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
  // Keyed to the *readout* rather than to the date, like the picker and for the
  // same reason: the join is against the two lists the day came back with, and
  // an add's re-read re-joins the paste the editor is still holding. The paste
  // itself never leaves the browser; what does is the **residue**, sent to the
  // dev-only evidence route to be told what is true of each word (#189), and
  // that lookup is a gesture rather than an effect so it does not run per
  // keystroke (`usePastedList.ts`). Nothing on either leg is written (ADR-0016).
  //
  // Accepting its main pile *is* written, and goes through `adder` — the same
  // hook the day panel's Submit uses, the same route, the same rebuild (#190).
  // The panel is handed the whole hook rather than a callback so that both
  // buttons read one `inFlight` field: two batches in flight would race over
  // `data/supplement.dict` and rebuild the index twice from two halves of the
  // night's work.
  //
  // The last answer goes the other way, into the paste, because a reading the
  // add sourced and could not use is a mark the pile carries from then on —
  // held across every later request rather than only the one that raised it
  // (`mergeRefusals`).
  //
  // The standing demotion list goes in too, because the evidence route applies
  // no demotions and would keep offering a word the editor has already refused
  // — as a name to demote again, or worse, as a word to source a reading for.
  // Read off the demoter rather than fetched again: it is the same list, and it
  // refreshes itself on every write, which is what takes a just-demoted word off
  // the pile without the paste being touched (#191).
  const demoted = useMemo(() => demotedWords(demoter.state?.standing ?? []), [demoter.state]);
  const paste = usePastedList(readout, adder.result, demoted);

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

  // Which panel is showing. Shell state, not a route (`EditorTabs`), and it
  // opens on the day because the day is what an Editor's Pass is a read of.
  const [tab, setTab] = useState<EditorTab>("day");

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

      {/* Everything from here to the tab strip is shell chrome: it belongs to no
          one panel, so it is drawn above them all and reaches the editor
          whichever tab is showing. A demotion and a Decline are both raised from
          two panels apiece, and a fetch that failed is about the screen rather
          than about anything on it. */}
      {error !== null && <section className="editor-alarm">{error}</section>}

      <DemoteBanner demoter={demoter} />

      {/* A refused ruling, said once. Quieter than the demote banner on purpose:
          a Decline that did not reach the file changes nothing at all, and its
          whole cost is that the Candidate is still on the queue — which is where
          it is. */}
      {decliner.error !== null && <p className="editor-write-failed">{decliner.error}</p>}

      <EditorTabs selected={tab} onSelect={setTab} />

      <TabPanel tab="day" selected={tab}>
        {/* The previous day stays on screen while the next one is fetched,
            dimmed rather than replaced: a blank screen between two days makes a
            jump feel like a failure, and a day's readout arrives in
            milliseconds. */}
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
      </TabPanel>

      {/* Dimmed on a jump for the day panel's reason and no other: a paste is
          held against whichever day is on screen, so while the next one is being
          fetched the counts below the box are the previous day's. The box itself
          keeps its text throughout — that is the point of holding it here. */}
      <TabPanel tab="paste" selected={tab}>
        <div className={loading ? "editor-body editor-loading" : "editor-body"}>
          <PastedListView readout={readout} paste={paste} adder={adder} demoter={demoter} />
        </div>
      </TabPanel>

      {/* Never dimmed while a day is fetched, unlike the day's own block: a
          Candidate is aimed at a Rhyme Key rather than at a date, and most of
          the queue belongs to no scheduled day at all, so nothing about it goes
          stale on a jump. The acts on it are the reason that holds for the
          *gestures* too — an add raised here aims at the Candidate's key, so
          nothing about it is a fact about the day on screen. */}
      <TabPanel tab="queue" selected={tab}>
        <CandidateQueueView
          queue={candidates.queue}
          error={candidates.error}
          loading={candidates.loading}
          acts={queueActs}
        />
      </TabPanel>

      {/* Not dimmed on a jump either, and for a plainer reason: it is about the
          repository rather than about the date on screen. */}
      <TabPanel tab="status" selected={tab}>
        <StatusView status={status} error={statusError} />
      </TabPanel>
    </main>
  );
}
