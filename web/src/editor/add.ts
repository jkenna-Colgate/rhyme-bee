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
 * ## Why the queue holds no Rhyme Key, but does hold a day
 *
 * An add is aimed at the **day's** Rhyme Key, and the editor never types one.
 * The queue therefore carries no key: the day is named at Submit by date, and
 * the endpoint resolves the key out of `data/schedule.json` itself. A key
 * carried in the browser would let a screen that had drifted from the schedule
 * aim an add with a figure of its own, which is the hole the ticket closed.
 *
 * It does carry the **date it was typed against**, and that is not the same
 * field. Without it, the aim was taken from whichever day happened to be on
 * screen at the click — so a queue typed against Monday, left standing while the
 * editor checked Tuesday, submitted its words at *Tuesday's* Rhyme Key with
 * nothing having said so. `queuedFor` is what makes that mismatch a thing
 * `aimHeldFor` can refuse rather than a thing the editor discovers in
 * `data/supplement.dict` afterwards.
 *
 * A date is safe to carry where a key is not, because it is not an answer to
 * anything: the endpoint still resolves the key from the schedule, and the date
 * is only ever compared with the day on screen. The queue never *aims* itself.
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
import type { DayReadout } from "../../../scripts/editorDay.ts";
import type { AddOutcome } from "./addOutcome.ts";

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

/**
 * Whether a queue typed against `queuedFor` may act on the day now on screen —
 * `null` when it may, and the sentence to show when it may not.
 *
 * ## Why a queue is bound to a day at all
 *
 * The Rhyme Key an add is aimed at is the day's, resolved server-side from the
 * date Submit sends. So a queue that outlives the day it was typed against is a
 * queue that will silently aim at whatever day is on screen when the button is
 * pressed: type `readjust` while Monday's `AH S T` is open, glance at Tuesday,
 * hit Submit, and the word is written against Tuesday's family instead. Nothing
 * on screen contradicts it, and the wrong reading is in
 * `data/supplement.dict` by the time anyone could. The whole point of taking the
 * key from the day was that nobody should be able to aim an add at the wrong
 * family; taking it from *the click* rather than from the queue put that back.
 *
 * ## Why the queue is not simply cleared on a day change
 *
 * Because that throws away typing the editor did, and the reason the queue
 * survives a day change is a real one: a pass on Monday routinely involves
 * opening Tuesday to check whether a word belongs there instead. Clearing makes
 * that glance cost the batch. Between losing work silently and writing to the
 * wrong family silently, the second is worse — but neither is the trade to make
 * when a third option holds the queue and refuses the act.
 *
 * ## What this does instead
 *
 * The queue stays, whole, and stops being *submittable* anywhere but its own
 * day. The editor is told which day it belongs to; going back there restores
 * Submit, and the words can still be removed one by one from anywhere. Two
 * further options were rejected: submitting to the queue's own date regardless
 * of what is displayed would write to a day the editor is not looking at and
 * then replace the screen with it, and a confirm dialog would make the correct
 * answer the one behind an extra click.
 *
 * The same check gates queueing, not only Submit. A word typed on Tuesday that
 * joined Monday's queue would be aimed at Monday — the identical mistake with
 * the days swapped, and it would be *created* by the very design meant to stop
 * it.
 */
export function aimHeldFor(queuedFor: string | null, date: string): string | null {
  if (queuedFor === null || queuedFor === date) return null;
  return (
    `These words were typed against ${queuedFor}, and an add is aimed at the day's own Rhyme Key. ` +
    `Go back to ${queuedFor} to submit them, or take them out of the queue to start one for this day.`
  );
}

/**
 * What one Submit asks for: a day, and the words queued against it.
 *
 * Declared here for the reason `AddSubmitResult` is, with the ends swapped:
 * on the request direction the browser writes the shape and the endpoint reads
 * it, so the module that cannot be imported is the reader.
 *
 * A day is named and a Rhyme Key is not — the endpoint resolves the key from
 * `data/schedule.json` itself (`web/editorAddRequest.ts` says why).
 */
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
  /**
   * What became of the batch, or **null when there was no batch** — the empty
   * Submit #162 added, where the pending work was already on disk and the only
   * act left was the rebuild.
   *
   * Null rather than an `AddOutcome` with no words in it. An empty outcome
   * would render as "0 readings written, 0 words deferred", which is true and
   * is an answer to a question nobody asked; the editor pressed a button that
   * said *rebuild*, and what they need told is whether the rebuild happened.
   * It also keeps the two cases apart for anything downstream: "no words were
   * submitted" and "every word in the batch was already known" are the same
   * counts and completely different facts.
   */
  outcome: AddOutcome | null;
  rebuilt: RebuildResult;
  readout: DayReadout | null;
}
