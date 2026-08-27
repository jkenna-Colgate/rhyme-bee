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
 * ## The two ways a queue names what it is aimed at
 *
 * An add lands on one Rhyme Key, and there are exactly two things that can say
 * which — a **day**, whose key the endpoint resolves out of `data/schedule.json`
 * itself, or a **Candidate**, which already carries the key it was Appealed
 * against. `AddAim` is that pair, and it is one field rather than two so that a
 * queue cannot be aimed at both or at neither.
 *
 * The day aim is the editor's own: they type a word the day is missing and never
 * type a key. Carrying the day's *key* in the browser was rejected and stays
 * rejected — it would let a screen that had drifted from the schedule aim an add
 * with a figure of its own, which is the hole #161 closed. So the day travels as
 * a date and the endpoint resolves the key.
 *
 * The Candidate aim is a **key named outright**, and it is safe for the opposite
 * reason: the key is not being derived from anything the screen might have wrong
 * about the schedule. It *is* the Candidate — the key the player's Appeal was
 * recorded against — and it is the only aim most of the queue can have, since
 * most Candidates belong to no scheduled day at all (#176, #178). A one-gesture
 * add reachable only from a day would be a gesture the largest group of the
 * queue could never use.
 *
 * Either way the aim is carried, and that is not a nicety. Without it the aim
 * was taken from whichever day happened to be on screen at the click — so a
 * queue typed against Monday, left standing while the editor checked Tuesday,
 * submitted its words at *Tuesday's* Rhyme Key with nothing having said so.
 * `aim` is what makes that mismatch a thing `aimClash` can refuse rather than a
 * thing the editor discovers in `data/supplement.dict` afterwards.
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
import type { RhymeKey } from "../../../src/phonology.ts";
import type { AddOutcome } from "./addOutcome.ts";

/**
 * What a queue is aimed at: a scheduled day, or a Rhyme Key named outright.
 *
 * A closed union rather than two nullable fields, so "a queue aimed at both" and
 * "a queue aimed at neither with words in it" are states that cannot be written
 * down. The two arms are the two things that can supply a key — see the module
 * comment — and they are not two kinds of add: `aimClash` treats them
 * identically, the endpoint judges every word the same way whichever arm sent
 * it, and the only difference downstream is which of the two the target came
 * from.
 */
export type AddAim =
  | { kind: "day"; date: string }
  | { kind: "key"; rhymeKey: RhymeKey };

/** Whether two aims name the same target, which is what lets one queue hold both words. */
function sameAim(a: AddAim, b: AddAim): boolean {
  if (a.kind === "day") return b.kind === "day" && a.date === b.date;
  return b.kind === "key" && a.rhymeKey === b.rhymeKey;
}

/**
 * How many words the editor may **type** into one queue.
 *
 * A browser-side ergonomic guard on the entry field, enforced nowhere else: it
 * shuts the field at the fifty-first word, and nothing downstream asks about it
 * again.
 *
 * ## It is not a cost bound, and #190 is why it stopped being one
 *
 * The cost it used to bound was **agent minutes** — a word no compound split
 * reaches goes to an agent that is given up to a minute (`AGENT_TIMEOUT_MS`,
 * `scripts/editorAdd.ts`), and those waits are serial — and those minutes are
 * the same whether the word was typed or pasted. #190 accepted that wait
 * deliberately for the pasted pile: the measured `idiotic` day's 197 words are
 * an overnight job the editor can walk away from, and the tool states how long
 * it may run rather than refusing on their behalf. A number that lets 197 pasted
 * words through and stops 51 typed ones is not bounding a cost, so this one no
 * longer claims to.
 *
 * What it still earns is the field. Fifty is past anything anyone types in a
 * sitting, and a queue that reaches it is a paste into the wrong box or a stuck
 * key — worth stopping at the keystroke, where it costs nothing. Stated in words
 * because that is the unit the editor is working in.
 *
 * ## Why nothing enforces it at the route
 *
 * The route's bound is {@link MAX_SUBMITTED_WORDS}, and *that* one is enforced
 * server-side, in `addWriteRequest` — "a cap only a client honours is not a cap"
 * was the argument for enforcing the route's bound at the route, and it is
 * untouched. There is **one** route bound rather than two because the route
 * cannot tell a typed batch from a pasted one, and must not be told: a field the
 * client sets to choose which cap applies to it is precisely a cap only a client
 * honours. So the fifty is what the entry field does, the two thousand is what
 * the route enforces, and the endpoint judges every word the same way whichever
 * gesture sent it.
 */
export const MAX_QUEUED_WORDS = 50;

/**
 * How many words one Submit may carry, whatever composed it.
 *
 * A **transport bound, not a workload one** — deliberately far above any list an
 * editor would paste, so that the volume is decided by what they select rather
 * than by a number in here (#186, story 19). The measured day's pile was 197 and
 * a third-party list queried for one Rhyme Key does not run to thousands; this
 * is the size past which a body has stopped being a rhyme list and started being
 * a mistake.
 *
 * There is a bound at all because `MAX_ADD_BODY_BYTES` is derived from it and a
 * route that will read an unbounded body is a route with no cap. What there is
 * *not* is a bound tuned to how long the batch will take: that cost is real, it
 * is stated to the editor while the Submit runs, and it is theirs to accept —
 * #190 is explicit that the wait is an overnight job to walk away from rather
 * than something the tool should refuse on their behalf.
 */
export const MAX_SUBMITTED_WORDS = 2000;

/**
 * The worst case one word can cost, in milliseconds: the bound
 * `scripts/editorAdd.ts` puts on the agent it asks to author a reading no
 * compound split reaches.
 *
 * Restated here rather than imported because importing it would pull the module
 * that spawns processes into the browser bundle. It is used only to say how long
 * a Submit *might* take, so a copy that drifted would cost an inaccurate sentence
 * rather than an incorrect act.
 *
 * In this module rather than beside the one view that used to hold it, because
 * two views now say the sentence — the add queue's own Submit and the pasted
 * pile's accept (#190) — and a second copy is a second thing to forget to move.
 */
export const WORST_CASE_MS_PER_WORD = 60_000;

const WORD = /^[a-z]+$/;

/**
 * Whether a spelling has the shape of a word: lower-case letters, which is how
 * `data/words.txt` holds all 370,105 of its entries.
 *
 * Checked in the browser so a typo with a stray character in it is refused at
 * the moment it is typed rather than a whole Submit later — the queue's promise
 * is that a mistake costs nothing, and a mistake that is only reported after the
 * batch has run has already cost the batch.
 *
 * Exported because the pasted rhyme list asks the same question of a third
 * party's entries (#188), where the answer means something else entirely — noise
 * to drop silently rather than a mistake to report. One rule, because a paste
 * that admitted a spelling the add queue refuses would nominate words that
 * cannot then be added.
 */
export function isWord(word: string): boolean {
  return WORD.test(word);
}

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
  if (!isWord(word)) {
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
 * Whether a word aimed at `wanted` may join a queue already aimed at `held` —
 * `null` when it may, and the sentence to show when it may not.
 *
 * ## Why a queue is bound to one aim at all
 *
 * One Submit carries one target. So a queue that mixed aims would land some of
 * its words on a family nobody chose for them: type `readjust` while Monday's
 * `AH S T` is open, glance at Tuesday, type another word, and one of the two is
 * written against a Rhyme Key nothing on screen named. The wrong reading is in
 * `data/supplement.dict` by the time anyone could contradict it.
 *
 * ## Why the queue is not simply cleared when the aim would change
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
 * The queue stays, whole, and refuses the word. The editor is told what it is
 * aimed at and what to do about it, and the words can still be removed one by
 * one from anywhere. A confirm dialog was rejected: it would make the correct
 * answer the one behind an extra click.
 */
export function aimClash(held: AddAim | null, wanted: AddAim): string | null {
  if (held === null || sameAim(held, wanted)) return null;
  if (held.kind === "day") {
    return (
      `These words were typed against ${held.date}, and an add is aimed at the day's own Rhyme Key. ` +
      `Go back to ${held.date} to submit them, or take them out of the queue to start one for this day.`
    );
  }
  return (
    `These words were raised from the Candidate Queue and are aimed at ${held.rhymeKey}. ` +
    "Submit them, or take them out of the queue, before starting one for this day."
  );
}

/**
 * Whether a queue may be *submitted* while `date` is on screen — `null` when it
 * may, and the sentence to show when it may not.
 *
 * A narrower question than `aimClash`, and deliberately not the same one. What
 * stops a day-aimed queue being submitted from another day is not that the aim
 * would be wrong — the aim travels with the queue and the endpoint honours it —
 * but that Submit answers with the day it wrote to and the screen would be
 * replaced by a day the editor was not looking at. That was one of the options
 * this rule rejected, and it is still rejected.
 *
 * A **key-aimed** queue is held by nothing, which is the whole point of naming
 * the key outright: most Candidates belong to no scheduled day, so a gate that
 * asked which day they were on could only ever answer "not this one" and the
 * largest group of the queue would be queueable and never submittable. Nothing
 * is re-read for such a Submit either, so there is no screen to replace.
 */
export function aimHeldFor(held: AddAim | null, date: string): string | null {
  if (held === null || held.kind === "key") return null;
  return aimClash(held, { kind: "day", date });
}

/**
 * What one Submit asks for: what the batch is aimed at, and the words in it.
 *
 * Declared here for the reason `AddSubmitResult` is, with the ends swapped:
 * on the request direction the browser writes the shape and the endpoint reads
 * it, so the module that cannot be imported is the reader.
 */
export interface AddSubmitRequest {
  /**
   * The day on screen. It does two things, and they are separable: it is what
   * the batch is aimed at when `rhymeKey` is absent — the endpoint resolves the
   * key from `data/schedule.json` itself (`web/editorAddRequest.ts` says why) —
   * and it is the day the answer re-reads either way, since the rebuild a
   * Submit runs folds in everything on disk and the figures on screen move with
   * it.
   *
   * `null` only for a batch aimed at a Rhyme Key that was raised before any day
   * had loaded: there is then nothing to re-read and nothing to resolve, which
   * is why `rhymeKey` is the field the request cannot do without.
   */
  date: string | null;
  /**
   * The Rhyme Key a Candidate supplied, aimed at directly (#178).
   *
   * One more way to name the target and not a second add: the words, the
   * judgements, the writes and the rebuild are identical whichever field
   * carried the aim. It exists because a Candidate already *has* a key — the
   * one its Appeal was recorded against — and most of the queue belongs to no
   * scheduled day, so resolving a key from a date would leave the largest group
   * of Candidates with no add at all.
   *
   * Absent for the ordinary editor add, which has no Candidate behind it and
   * takes its aim from the day.
   */
  rhymeKey?: RhymeKey;
  words: string[];
  /**
   * Which of `words` were raised from the Candidate Queue rather than typed by
   * the editor (#178) — always a subset, and empty for a batch the editor
   * composed themselves.
   *
   * A second list rather than a shape change to `words`, because it is a fact
   * about *where a word came from* and not about the word: the queue is a
   * `string[]`, `queueAdd` refuses a duplicate by name, and the endpoint judges
   * every word identically whatever list it is also on. All the field decides is
   * whether the reading that lands in `data/supplement.dict` carries a comment
   * saying a player asked for it — which is the one place that provenance can be
   * kept, since the supplement is what outlives the pass.
   */
  appealed: string[];
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
 * `readout` is **null when the rebuild failed**, and that is not an
 * omission. The index on disk is then the one from before the adds, and a day
 * re-read from it would put figures on screen that look like the result of the
 * pass and are not. `DayReadoutView` already takes that position for a day the
 * editor has moved — it withdraws the band verdicts rather than guessing at
 * them — and this is the same call one layer out: a stale re-read displayed as
 * a fresh one is the failure this whole route exists to avoid.
 *
 * It is null for one further reason: a batch aimed at a Rhyme Key that named no
 * date has no day to re-read. The screen keeps whatever it had, which is right
 * — nothing about it was being looked at when the words were raised.
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
