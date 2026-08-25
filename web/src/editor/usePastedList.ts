/**
 * The pasted rhyme list, held for as long as the tab is open, and the facts the
 * residue was looked up against.
 *
 * **Held for the sitting, deliberately** — and never a Session, which is a
 * player's play-through of a Puzzle and a thing an Editor's Pass never opens.
 * The paste lives in memory and nowhere else —
 * no file, no `localStorage`, no cache, no reproducibility guarantee. It is held
 * *above* the day fetch, in the shell with every other Editor's Pass hook, which
 * is the whole of what makes it survive a rebuild: submitting an add on the day
 * tab re-reads the day, the join runs again against the new readout, and the
 * editor does not re-paste. Held inside the panel it would not even survive a
 * tab switch, since `TabPanel` unmounts the panels that are not showing.
 *
 * It dies with the tab, and that is the point. Seed Words do not repeat across
 * the scheduled run, so a paste kept on disk would earn its keep at most once
 * per Rhyme Key, ever, in exchange for a stale list quietly reused on a later
 * night.
 *
 * ## Why the lookup is a gesture and not an effect
 *
 * The residue changes on every keystroke in the box, and a lookup is not cheap
 * at the far end: `pinnedEvidenceContext` parses `data/cmudict.dict`, applies the
 * committed supplement and runs Normalisation, once per request and deliberately
 * uncached (`web/editorEvidencePlugin.ts`). An effect keyed on the residue would
 * do all of that per character typed. So the editor asks, once, after pasting.
 *
 * What that costs is a stale answer, and it is not paid — but the rule that
 * stops it is not here. The last reply is handed to the join unconditionally,
 * and the join refuses one gathered against another Rhyme Key or one that does
 * not answer about the whole residue. Edit the box and the buckets go back to
 * null, which is what is true, and is why `PastedList.buckets` is nullable
 * rather than three empty arrays.
 *
 * A **rebuild is the other way round, and deliberately so**. An accept re-reads
 * the day, the words that got readings are covered by the Puzzle, and the
 * residue shrinks to a *subset* of what the reply answered about — which the
 * join's check (`residue.every((word) => facts.has(word))`) passes. So the
 * buckets survive an accept on pre-rebuild evidence, which is what keeps the
 * pile on screen instead of asking for a second lookup about words nothing has
 * changed about.
 *
 * No tests, and the reason is not that hooks are exempt from them: every rule
 * this feature has lives in `pastedList.ts`, which is pure and tested over
 * literals, and the endpoint's own refusals are tested through its middleware.
 * What is left here is `useState`, a fetch, a `useMemo` and two effects that
 * hand the accumulated refusals to a function tested over literals.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { EDITOR_EVIDENCE_PATH } from "../endpoints.ts";
import type { AddSubmitResult } from "./add.ts";
import type { EvidenceReply } from "./evidence.ts";
import { readEndpointResponse } from "./fetchError.ts";
import { joinPastedList, mergeRefusals, type PastedList } from "./pastedList.ts";

/**
 * No refusals, as one value: handed back on every day change so that clearing a
 * map that is already clear is not a re-render.
 */
const NO_REFUSALS: ReadonlyMap<string, string> = new Map();

export interface Paste {
  /** What the editor pasted, verbatim — the box's own value. */
  text: string;
  setText: (text: string) => void;
  /** That text joined against the day on screen, with the buckets when they hold. */
  list: PastedList;
  /**
   * Ask the endpoint what is true of the residue. A no-op with nothing to ask
   * about, so the button can be pressed on an empty box without inventing a
   * request.
   */
  look: () => Promise<void>;
  /** Whether a lookup is in flight. */
  looking: boolean;
  /**
   * The readings this sitting's adds sourced for the day's Rhyme Key and could
   * not use — each word against what was proposed for it, respelled — held
   * across every request rather than only the last one.
   *
   * Held here rather than derived in the panel because the accumulation is a
   * fact about the sitting and not about the outcome on screen: one outcome is
   * on the hook at a time, and reading the hold-back set off it alone would drop
   * a refusal the moment anything else was submitted. `mergeRefusals` is the
   * rule; this is where the running total lives. About one Rhyme Key, exactly as
   * the evidence reply is, and cleared with it.
   */
  refused: ReadonlyMap<string, string>;
  /** What went wrong with the last lookup, if anything. Nothing was written. */
  error: string | null;
}

export function usePastedList(readout: DayReadout | null, result: AddSubmitResult | null): Paste {
  const [text, setText] = useState("");
  const [looked, setLooked] = useState<EvidenceReply | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(NO_REFUSALS);

  const rhymeKey = readout !== null && readout.outcome === "day" ? readout.rhymeKey : null;

  // A refusal is "the reading sourced for this word does not land on *this*
  // key", so it says nothing about the next day and is dropped with the day
  // rather than carried onto it — the same rule the evidence reply is under, for
  // the same reason. Declared above the merge so that on a day change the two
  // run in order: clear, then merge this day's outcome into an empty map.
  useEffect(() => {
    setRefused(NO_REFUSALS);
  }, [rhymeKey]);

  // Every request's refusals, accumulated. Keyed on the last answer rather than
  // read at the render, because what is on screen has to outlive the outcome it
  // came from: a second accept, or a typed Submit on the day tab, replaces
  // `result` and would otherwise unmark every word the previous one held back.
  useEffect(() => {
    if (rhymeKey === null) return;
    setRefused((held) => mergeRefusals(held, result?.outcome ?? null, rhymeKey));
  }, [rhymeKey, result]);

  // Re-joined when any of the three moves: a fresh paste, a day re-read off a
  // rebuilt index, or a lookup coming back. The second is what a rebuild costs
  // here, and it is nothing.
  //
  // The last reply is handed over unconditionally and there is no staleness
  // check here, because there is one in the join: it refuses a reply gathered
  // against another Rhyme Key, and refuses one that does not answer about the
  // whole residue. Both are rules about what the evidence *is*, so they live
  // where everything else this feature knows lives and are tested over literals.
  const list = useMemo(
    () => joinPastedList(text, readout, looked),
    [text, readout, looked],
  );

  const look = useCallback(async () => {
    const day = readout !== null && readout.outcome === "day" ? readout : null;
    if (day === null || list.residue.length === 0) return;

    setLooking(true);
    setError(null);
    try {
      const response = await fetch(EDITOR_EVIDENCE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rhymeKey: day.rhymeKey, words: list.residue }),
      });
      const read = await readEndpointResponse<EvidenceReply>(response, "evidence");
      if (read.ok) setLooked(read.body);
      else setError(read.error);
    } catch (cause) {
      // Its own sentence rather than `endpointFailure`, on that helper's own
      // rule: it exists for the routes that write, and its "Nothing was written"
      // is a claim this route has no business making either way. The day and
      // status reads say this instead, for the same reason.
      setError(
        cause instanceof Error
          ? `${cause.message} — is the dev server still running?`
          : "The evidence endpoint could not be reached.",
      );
    } finally {
      setLooking(false);
    }
  }, [readout, list.residue]);

  return { text, setText, list, look, looking, refused, error };
}
