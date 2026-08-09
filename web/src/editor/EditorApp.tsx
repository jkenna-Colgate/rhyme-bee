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
 * *remember* the day it was typed against: an add is aimed at the day's own
 * Rhyme Key, resolved server-side from the date Submit sends, so a queue that
 * forgot where it came from would take its aim from whichever day happened to be
 * on screen at the click and write Monday's words against Tuesday's family. A
 * queue standing on another day is shown in full and cannot be added to or
 * submitted until the editor navigates back to it — `aimHeldFor`
 * (`web/src/editor/add.ts`) is that rule and argues for it.
 *
 * `show` is how Submit's re-read lands: the endpoint answers with the day read
 * off the index it has just rebuilt, and the readout is handed to the hook that
 * owns the day rather than kept a second time by the one that submitted.
 *
 * The status is the fourth hook and belongs to none of the three above it. It
 * is about the repository rather than a day — whether the built Rhyme Index is
 * stale, and whether the files the pass writes are committed (#162) — so it is
 * fetched once, refreshed when a write lands or the window is focused, and
 * never keyed to the date. It is drawn here, at the top, and passed down as far
 * as the add queue for the one rule that reads it: Submit is enabled by a stale
 * index as well as by a queued add.
 */

import { useEffect, useState } from "react";
import { useAdder } from "./useAdder.ts";
import { useDayReadout } from "./useDayReadout.ts";
import { useDemoter } from "./useDemoter.ts";
import { useEditorStatus } from "./useEditorStatus.ts";
import { useTierPicker } from "./useTierPicker.ts";
import { DayReadoutView } from "./DayReadoutView.tsx";
import { StatusView } from "./StatusView.tsx";

export function EditorApp() {
  const { readout, loading, error, goTo, show } = useDayReadout();
  const picker = useTierPicker(readout?.date ?? null);
  const demoter = useDemoter();
  const adder = useAdder(show);
  const { status, error: statusError, refresh } = useEditorStatus();

  // The status is refreshed by **observing** that a write happened, rather than
  // by three callbacks threaded through three hooks. Each of these three values
  // is set only on a write the file accepted — `picker.recorded` on a Tier
  // verdict, `demoter.recorded` on a demotion, `adder.result` on a Submit — and
  // each is a fresh object every time, so two identical verdicts in a row are
  // still two refreshes. A callback per hook would be a second announcement of
  // a fact each hook already publishes, and one more thing for a fourth write
  // route to remember to call.
  //
  // A *failed* write sets none of them, and correctly triggers nothing: what it
  // changed on disk is nothing.
  useEffect(() => {
    if (picker.recorded === null && demoter.recorded === null && adder.result === null) return;
    refresh();
  }, [picker.recorded, demoter.recorded, adder.result, refresh]);
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
            status={status}
          />
        </div>
      )}

      {readout === null && loading && <p className="editor-muted">Reading the day…</p>}
    </main>
  );
}
