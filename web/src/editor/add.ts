/**
 * The add queue: the words the Editor's Pass turned up as missing, held in the
 * browser until Submit makes them real.
 *
 * ## Why the queue is the browser's and not the disk's
 *
 * Naming ten words has to be as cheap as naming one, and a mistyped word has to
 * be removable before it costs anything (#161). A queue that wrote as it grew
 * could not offer either: every name would be a round trip, a wrong one would
 * already be in `data/supplement.dict`, and the editor would be composing their
 * list one irreversible act at a time. So nothing here talks to a server. The
 * queue is a `string[]`, it is lost if the tab closes, and losing it costs
 * exactly the retyping — which is the trade the ticket asks for by name.
 *
 * ## Why the queue holds no Rhyme Key
 *
 * An add is aimed at the **day's** Rhyme Key, and the editor never types one.
 * The queue therefore carries words alone, and the day is named once, at Submit,
 * by date — from which the endpoint resolves the key out of `data/schedule.json`
 * itself. Carrying a key per queued word would let a queue survive a jump to
 * another day and land its words on the wrong family; carrying the key at all
 * would let a screen that had drifted from the schedule aim an add with a figure
 * of its own. Neither is worth the field.
 *
 * ## Why these are not Submissions, and not Candidates
 *
 * A Submission is a word *a player* enters against a Puzzle, and a Candidate is
 * the record an Appeal becomes. Neither word is used here: this is the editor's
 * own list of words the game is missing, and blurring the three would make the
 * queue read as a thing the game must adjudicate. It is not — it is a list of
 * words to give readings to.
 */

import { normaliseWord } from "../../../src/cmudict.ts";
import type { AddOutcome } from "../../../scripts/editorAdd.ts";
import type { DayReadout } from "../../../scripts/editorDay.ts";

/**
 * How many words one Submit will carry.
 *
 * The binding cost is not bytes — a hundred words is a couple of kilobytes — it
 * is **time**: a word no compound split reaches goes to an agent that is given
 * up to a minute (`AGENT_TIMEOUT_MS`, `scripts/editorAdd.ts`), and those waits
 * are serial. Fifty words is therefore a worst case of about fifty minutes,
 * which is already past the point where an editor should be splitting the batch
 * rather than watching it. The limit is stated in words because that is the unit
 * whose cost is real, and it is enforced in the browser *and* at the endpoint:
 * the browser so the fifty-first word is refused before it is queued, the
 * endpoint because a cap only a client honours is not a cap.
 */
export const MAX_QUEUED_WORDS = 50;

/**
 * Words are lower-case letters, the shape `data/words.txt` holds all 370,105 of
 * its entries in. Checked here, in the browser, so a typo with a stray character
 * in it is refused at the moment it is typed rather than a whole Submit later —
 * the queue's promise is that a mistake costs nothing, and a mistake that is
 * only reported after the batch has run has already cost the batch.
 */
const WORD = /^[a-z]+$/;

export type QueueResult = { ok: true; queue: string[] } | { ok: false; error: string };

/**
 * Add a typed word to the queue.
 *
 * Normalised with `normaliseWord`, the same function `data/demotions.txt`'s
 * parser and the demote route use, so a word queued with a stray capital or a
 * trailing space is the word the endpoint judges rather than a near-miss of it.
 *
 * A word already queued is refused rather than queued twice: `resolveAddOutcome`
 * would judge it twice against the same evidence and reach the same outcome
 * both times, so a duplicate is a row in the readout that says nothing — and,
 * on the written path, two identical lines appended to `data/supplement.dict`.
 */
export function queueAdd(queue: readonly string[], typed: string): QueueResult {
  const word = normaliseWord(typed);
  if (word === "") return { ok: false, error: "Type a word to add." };
  if (!WORD.test(word)) {
    return { ok: false, error: `“${typed.trim()}” is not a word. An add names one word, in letters.` };
  }
  if (queue.includes(word)) return { ok: false, error: `${word} is already queued.` };
  if (queue.length >= MAX_QUEUED_WORDS) {
    return {
      ok: false,
      error:
        `That is ${MAX_QUEUED_WORDS} words already, which is as many as one Submit carries. ` +
        "Submit these, then queue the rest.",
    };
  }
  return { ok: true, queue: [...queue, word] };
}

/**
 * Take a word back out. By name rather than by position, because the queue is
 * rendered in the order it was typed and a removal is a click on the word
 * itself — an index would be a second model of the same list, agreeing with the
 * render only for as long as nobody sorted it.
 */
export function unqueueAdd(queue: readonly string[], word: string): string[] {
  return queue.filter((queued) => queued !== word);
}

/** What one Submit asks for: a day, and the words queued against it. */
export interface AddSubmitRequest {
  date: string;
  words: string[];
}

/**
 * Whether the rebuild Submit ran actually happened.
 *
 * A failure here is not a failure of the adds: by the time the index is
 * rebuilt the readings are already in `data/supplement.dict`, and saying so is
 * the difference between an editor who reruns `npm run build:index` and one who
 * retypes a batch that is already on disk.
 */
export type RebuildResult = { ok: true } | { ok: false; error: string };

/**
 * What the endpoint answers a Submit with: what became of each word, whether
 * the index was rebuilt, and the day re-read from the artifact that rebuild
 * produced.
 *
 * `readout` is **null exactly when the rebuild failed**, and that is not an
 * omission. The index on disk is then the one from before the adds, and a day
 * re-read from it would put figures on screen that look like the result of the
 * pass and are not. `DayReadoutView` already takes that position for a day the
 * editor has moved — it withdraws the band verdicts rather than guessing at
 * them — and this is the same call one layer out: a stale re-read displayed as
 * a fresh one is the failure this whole route exists to avoid.
 *
 * Declared here rather than beside the endpoint that builds it, for the reason
 * `DemotionWriteResult` is: the browser cannot import that module — it opens
 * files and spawns processes — and two declarations of one wire shape is
 * exactly the pair that drifts.
 */
export interface AddSubmitResult {
  outcome: AddOutcome;
  rebuilt: RebuildResult;
  readout: DayReadout | null;
}
