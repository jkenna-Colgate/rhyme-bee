/**
 * The pasted rhyme list, held for as long as the tab is open.
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
 * No tests, and the reason is not that hooks are exempt from them: every rule
 * this feature has lives in `pastedList.ts`, which is pure and tested over
 * literals. What is left here is `useState` and a `useMemo` over it, and a test
 * of that would be a test of React.
 */

import { useMemo, useState } from "react";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { joinPastedList, type PastedList } from "./pastedList.ts";

export interface Paste {
  /** What the editor pasted, verbatim — the box's own value. */
  text: string;
  setText: (text: string) => void;
  /** That text joined against the day on screen. */
  list: PastedList;
}

export function usePastedList(readout: DayReadout | null): Paste {
  const [text, setText] = useState("");
  // Re-joined when either side moves: a fresh paste, or a day re-read off a
  // rebuilt index. The second is what a rebuild costs here, and it is nothing.
  const list = useMemo(() => joinPastedList(text, readout), [text, readout]);
  return { text, setText, list };
}
