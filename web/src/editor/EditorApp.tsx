/**
 * The editor's screen: the day, and the one control that changes which day.
 *
 * It opens on tomorrow — the endpoint's default, asked for by naming no date at
 * all — because tomorrow is the day an Editor's Pass is nearly always about.
 * Typing a date jumps there, including to a date the run does not cover, which
 * the readout answers by naming the run's edges.
 *
 * This is the whole of the first slice (#158). There is no Tier picker, no
 * demote, no add and no Submit: those are #159–#162, and the screen they land on
 * is this one.
 */

import { useState } from "react";
import { useDayReadout } from "./useDayReadout.ts";
import { DayReadoutView } from "./DayReadoutView.tsx";

export function EditorApp() {
  const { readout, loading, error, goTo } = useDayReadout();
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

      {/* The previous day stays on screen while the next one is fetched, dimmed
          rather than replaced: a blank screen between two days makes a jump feel
          like a failure, and a day's readout arrives in milliseconds. */}
      {readout !== null && (
        <div className={loading ? "editor-body editor-loading" : "editor-body"}>
          <DayReadoutView readout={readout} />
        </div>
      )}

      {readout === null && loading && <p className="editor-muted">Reading the day…</p>}
    </main>
  );
}
