/**
 * The Decline gesture: the three rulings it offers, what each one writes, and
 * the sentence the editor reads **before** taking it.
 *
 * ## Three choices, three consequences, two files
 *
 * A Decline is the editor's ruling that a Candidate should not become an Answer,
 * together with the choice of what the player is told instead (#176). Only one
 * of the three is a new write:
 *
 * - **proper-noun** and **not-a-known-word** are the *existing* demote gesture,
 *   reached from here with the word prefilled. `data/demotions.txt` already
 *   holds exactly those two reasons and its own documentation names them as the
 *   two the gesture offers, so there is one demotion path in the tool rather
 *   than a second file recording the same fact. The demotion list's remit is
 *   unchanged by this: declining a Candidate as a Proper Noun writes the row an
 *   editor could already have written from the day view, and nothing here
 *   widens what a demotion means.
 * - **reason-is-correct** is the only case `data/declines.txt` records. The
 *   engine's rejection already says the right thing, the editor agrees with it,
 *   and the ruling exists so a Candidate they have considered stops appearing.
 *
 * The honest-reading Decline — the word is real and genuinely does not rhyme —
 * is deliberately **not** here. Making the engine say "doesn't rhyme" means
 * giving the word wordhood and a reading, which is an add rather than a Decline,
 * and it lives with the corrections work (#180).
 *
 * ## Why a demotion does not also settle the Candidate
 *
 * It does not, and that is the ticket's rule rather than an oversight: a
 * demotion writes the demotion list and nothing else. A demoted name still
 * reads `is-a-name` on the next render, because `gatherEvidence` asks the names
 * data and a demotion does not change the answer — so an editor who wants a name
 * off the queue as well as out of the game takes both acts, and the second one
 * is `reason-is-correct`, which is by then exactly true. Folding the two into one
 * click would be the second write path the ticket rules out.
 *
 * ## Why the consequence sentences live here
 *
 * Because one of them is load-bearing. Declining as a Proper Noun takes the
 * word's wordhood on **every** day, which is a per-Candidate act with a reach
 * far past the Candidate, and the editor has to be told so before they click
 * rather than after. A sentence that only exists inside JSX is a sentence no
 * test can hold to account — `showsDemotionReassurance` in `demote.ts` is the
 * same split for the same reason.
 */

import type { Decline } from "../../../src/declines.ts";
import type { DemotionReason } from "../../../src/demotions.ts";

/**
 * What the endpoint answers an accepted Decline with: the ruling as written, and
 * nothing else.
 *
 * Not the file's refreshed state. Which Candidates stand declined is already
 * derived server-side on every read of the queue (`scripts/editorCandidates.ts`)
 * — deriving it in one place is the point (#176) — so a second copy answered
 * here would be a second answer to one question, and the screen would have to
 * pick. What the browser cannot get any other way is confirmation that *this*
 * ruling reached the disk, which is what this is.
 *
 * Declared here rather than beside the endpoint that builds it, for the reason
 * `DemotionWriteResult` is: the browser cannot import that module — it opens
 * files — and two declarations of one wire shape is exactly the pair that
 * drifts.
 */
export interface DeclineWriteResult {
  /** The ruling as written, shown rather than described. */
  appended: Decline;
}

/**
 * The three rulings the gesture offers, in the order it offers them.
 *
 * The first two are `DemotionReason`s and are spelled identically to them on
 * purpose — they *are* those reasons, sent to the demote route — so the union
 * below is checked against `src/demotions.ts` rather than agreeing with it by
 * eye. The third is this ticket's own.
 */
export type DeclineChoice = DemotionReason | "reason-is-correct";

export const DECLINE_CHOICES: readonly DeclineChoice[] = [
  "proper-noun",
  "not-a-known-word",
  "reason-is-correct",
];

/** Which of the two files a choice writes. Nothing else writes anything. */
export type DeclineWrite = "demotion" | "decline";

/**
 * Where a choice lands. A `Record` over the closed union rather than a `switch`
 * with a default: a fourth choice cannot be added without this table refusing to
 * compile, which is the shape `REJECTION_MESSAGE` uses for the same guarantee
 * (ADR-0005).
 */
const WRITES: Record<DeclineChoice, DeclineWrite> = {
  "proper-noun": "demotion",
  "not-a-known-word": "demotion",
  "reason-is-correct": "decline",
};

/** Which file this ruling is written to — the demotion list, or the Declines. */
export function declineWrites(choice: DeclineChoice): DeclineWrite {
  return WRITES[choice];
}

/**
 * The same question, asked so that a caller can *act* on the answer: true when
 * this ruling is a demotion, narrowing the choice to the `DemotionReason` the
 * existing demote gesture takes.
 *
 * A predicate over the one table rather than a second condition at the call
 * site. The alternative — testing for `"reason-is-correct"` where the write is
 * dispatched — would put the routing rule in the screen, where a fourth choice
 * could be added and silently written nowhere; here the table is the only thing
 * that decides, and it cannot compile without an entry.
 */
export function isDemotionDecline(choice: DeclineChoice): choice is DemotionReason {
  return WRITES[choice] === "demotion";
}

/** The button's own words: the ruling, as the editor would say it. */
export const DECLINE_LABEL: Record<DeclineChoice, string> = {
  "proper-noun": "a Proper Noun",
  "not-a-known-word": "not a word we know",
  "reason-is-correct": "the reason is already right",
};

/**
 * What each ruling will do, shown **beside the button and before it is clicked**.
 *
 * The Proper Noun sentence is the one the ticket names: a Candidate is one
 * player's report about one Puzzle, and declining it as a name takes the word's
 * wordhood from every Puzzle that ever held it, on every day, reversible only by
 * a hand edit. An editor who learns that from the result rather than from the
 * button has already done it.
 *
 * It says one more thing, for the same reason: that the Candidate is **still on
 * the queue** afterwards. `gatherEvidence.isName` asks the names data and a
 * demotion does not change the answer, so the card comes back reading
 * `is-a-name` and clearing it takes a second ruling. Left unsaid, the editor
 * discovers the second act by watching the first one appear not to work.
 */
export const DECLINE_CONSEQUENCE: Record<DeclineChoice, string> = {
  "proper-noun":
    "Writes data/demotions.txt. This takes the word's wordhood on every day, not just this " +
    "one — it is removed from every Puzzle that holds it and rejected as a name everywhere. " +
    "Reversing it is a hand edit. The Candidate stays on the queue afterwards, because the " +
    "names data still reads the word as a name; taking it off is a second Decline, of “the " +
    "reason is already right”.",
  "not-a-known-word":
    "Writes data/demotions.txt. This takes the word's wordhood on every day, not just this " +
    "one, and the player is told it is not a word we know. Reversing it is a hand edit.",
  "reason-is-correct":
    "Writes data/declines.txt, and nothing else. No verdict changes anywhere: the engine's " +
    "rejection already says the right thing, and this only stops the Candidate coming back " +
    "on this Rhyme Key.",
};
