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
import type {
  ComposedReading,
  ReadingEvidence,
  RelativeEvidence,
} from "../../../src/supplementEvidence.ts";
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

/**
 * The evidence one card shows — the three kinds a Candidate can carry, with the
 * ones its own case does not turn on emptied.
 *
 * Total rather than optional-per-card: every card gets all three fields and the
 * ones it has no use for are empty, so a renderer maps over three lists instead
 * of asking which of them exist.
 */
export interface CardEvidence {
  /** The word's own readings, each with the Rhyme Key it computes to. */
  readings: ReadingEvidence[];
  /** Inflectional relatives a reading could be derived from. */
  relatives: RelativeEvidence[];
  /** A reading composed from a compound split, when one reaches the target. */
  composed: ComposedReading | null;
}

const NOTHING: CardEvidence = { readings: [], relatives: [], composed: null };

/**
 * Which evidence a Candidate's card shows, as a pure selection.
 *
 * **A card shows the evidence its own case turns on and not the rest** (#176),
 * which is what keeps the screen readable at the point of judgement. The two the
 * ticket names:
 *
 * - a **correction** card shows the **direct readings** and no relatives. The
 *   judgement is about the reading the engine holds — it is on the screen beside
 *   the agent's proposal, and that pairing is the whole of what is being
 *   approved. A relative would be evidence for deriving a reading the word
 *   already has.
 * - a **derivation** card shows the **relatives** and the composed reading, and
 *   no direct reading. The judgement is whether the derivation is defensible,
 *   and the word has no reading of its own to weigh it against.
 *
 * It is a function rather than a `switch` in the JSX for `cardFor`'s reason and
 * one more: this is a rule the ticket states about the screen, and a rule that
 * only exists inside a component is a rule no test can hold to account —
 * `showsDemotionReassurance` in `demote.ts` and `DECLINE_CONSEQUENCE` are the
 * same split for the same reason.
 *
 * The two cases cannot overlap in practice: `gatherEvidence` never searches for
 * relatives for a word that already reads, so a correction's `relatives` is
 * empty at the source. Emptying it here anyway is what makes the rule structural
 * rather than a property of the evidence gatherer that a later change could take
 * away silently.
 */
export function evidenceFor(candidate: ReadCandidate): CardEvidence {
  switch (candidate.state) {
    case "declined":
    case "is-a-name":
      // Neither ruling is made from a reading. A Decline is already made, and a
      // name is never valid however well it rhymes.
      return NOTHING;
    case "resolved":
    case "needs-correction":
      return { readings: candidate.readings, relatives: [], composed: null };
    case "addable":
      return cardFor(candidate) === "derivation"
        ? { readings: [], relatives: candidate.relatives, composed: candidate.composed }
        : { readings: candidate.readings, relatives: [], composed: null };
  }
}

/**
 * Whether the one-gesture add is offered for this Candidate.
 *
 * `addable` and nothing else. It is the state that means the engine has no
 * reading it will accept for the word, which is exactly what an add supplies —
 * a reading aimed at the Rhyme Key, plus the wordhood the supplement grants
 * (ADR-0009). It covers both `addable` cards: the plain one, and the derivation
 * one, whose relatives are evidence for the same act rather than a different
 * act.
 *
 * `needs-correction` is deliberately excluded and is not an oversight: the
 * engine already holds a reading there, and writing a second one over it is a
 * correction, which is slice 3's (#180). An add offered on that card would
 * silently replace a pronunciation nobody had approved replacing.
 */
export function offersAdd(candidate: ReadCandidate): boolean {
  return candidate.state === "addable";
}

// There is deliberately no `offersDecline` beside `offersAdd`. The Decline is
// offered to exactly the Candidates that still want a ruling, which is
// `isOutstanding` — the same test this file already counts `outstanding` with,
// and the same one the panel and the whole-queue list read. A predicate here
// would only forward to it under a second name, and the reasoning it would
// carry belongs where the gesture is drawn (`CandidateQueueView.tsx`).
