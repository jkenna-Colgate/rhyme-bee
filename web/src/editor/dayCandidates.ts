/**
 * The day's own Candidates, selected out of the one Candidate Queue readout by
 * Rhyme Key.
 *
 * ## Why this is a filter and not a second delivery
 *
 * The endpoint answers with the whole queue, grouped by Rhyme Key and with every
 * state already derived (`scripts/editorCandidates.ts`). A day is one Rhyme Key,
 * so the panel an editor sees while reading a day is that readout narrowed to
 * one group — one implementation, two call sites (#176).
 *
 * The alternative was a field on the day readout. It was rejected because a fact
 * about Candidates is not a fact about the day: `DayReadout` is a three-variant
 * union already consumed by the Tier re-tiering, the Corrected Day and the day
 * view, and none of the three has any business growing a case for it. Nothing in
 * this slice touches that payload, and if it ever needs to, the shape has gone
 * wrong.
 *
 * ## Why it computes nothing
 *
 * Unlike `retier.ts` — the browser's one deliberate exception, which recomputes
 * because a Tier verdict reaches the file before it reaches the index — there is
 * nothing here to recompute. A Candidate's state is derived server-side from the
 * pinned sources on every read, and the browser has neither the readings nor the
 * Normalisation to second-guess it with. So this selects and counts, and every
 * state on the screen is the one Node decided.
 */

import type { RhymeKey } from "../../../src/phonology.ts";
import {
  isOutstanding,
  type CandidateQueueReadout,
  type ReadCandidate,
} from "../../../scripts/editorCandidates.ts";

/** One day's slice of the queue. */
export interface DayCandidates {
  /** The key selected on — the day's own, never a key the panel chose. */
  rhymeKey: RhymeKey;
  /** Every Candidate aimed at this key, settled ones included. */
  all: ReadCandidate[];
  /** The ones that still want a ruling, which is what the panel is for. */
  outstanding: ReadCandidate[];
  /**
   * The Seed Words they were raised against, in first-seen order. More than one
   * means another Puzzle's players Appealed into this rhyme family — `docked`
   * in Free Play and `shellshocked` on its scheduled day is the live case — and
   * that is worth showing, because the day's own Seed Word is then not the whole
   * story of what is on the panel.
   */
  seedWords: string[];
}

/**
 * The Candidates aimed at one Rhyme Key.
 *
 * **Total, and never null.** A queue that has not loaded, a queue that failed to
 * load and a day with nothing Appealed against it are three different facts, but
 * they are the same thing to render — no panel — and the caller distinguishes
 * them from the fetch's own state rather than from a shape returned here. So an
 * absent queue and an absent group both come back empty, and the view's one
 * question is whether `all` holds anything.
 */
export function candidatesForDay(
  queue: CandidateQueueReadout | null,
  rhymeKey: RhymeKey,
): DayCandidates {
  const group = queue?.groups.find((g) => g.rhymeKey === rhymeKey);
  if (group === undefined) return { rhymeKey, all: [], outstanding: [], seedWords: [] };
  return {
    rhymeKey,
    all: group.candidates,
    outstanding: group.candidates.filter(isOutstanding),
    seedWords: group.seedWords,
  };
}

/**
 * Which card a Candidate's state selects, as one name.
 *
 * Slice 1 draws every card as a read: the state's own name, the word, and the
 * evidence its case turns on. The mapping is a function rather than a `switch`
 * in the JSX because it is what slices 2 to 4 hang their gestures off — the add,
 * the demote and the approve-a-correction all dispatch on exactly this — and a
 * closed union read in one place cannot drift from one read in four.
 */
export function cardFor(candidate: ReadCandidate): CandidateCard {
  switch (candidate.state) {
    case "resolved":
      return "settled";
    case "declined":
      return "settled";
    case "is-a-name":
      return "name";
    case "needs-correction":
      return "correction";
    case "addable":
      // A word the pinned sources already read, on the target, and which lacks
      // only wordhood: there is no reading to derive and none to correct, so it
      // is the plain add and not the derivation card.
      return candidate.relatives.length > 0 || candidate.composed !== null
        ? "derivation"
        : "add";
  }
}

/**
 * The cards the five states resolve to — five of them, but not one per state:
 * `resolved` and `declined` share `settled`, and `addable` splits on whether
 * there is anything to derive from.
 */
export type CandidateCard = "settled" | "name" | "correction" | "add" | "derivation";
