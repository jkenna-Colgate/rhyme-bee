/**
 * The Candidate Queue's **second section**: the readings the add path asked an
 * agent for and did not get (#181).
 *
 * `data/deferred-readings.jsonl` is written by `appendToDeferredQueue`
 * (`scripts/editorAdd.ts`) every time a word reaches the agent and comes back
 * with nothing usable, and until this module it had **never been read back** —
 * so a tooling failure silently swallowed an add the editor had asked for. This
 * is the read back, and it is the same shape as the queue's first section for
 * the same reasons: one function takes the parsed records and an evidence
 * context and returns a state per record, so the view renders and the acts
 * dispatch rather than either of them deriving anything (#176).
 *
 * ## Two cases, already distinguished in what was recorded
 *
 * The `reason` field the add path wrote is the whole of the difference:
 *
 * - **`agent-unavailable`** — a missing CLI, a non-zero exit, unparseable output
 *   or a process that hung. Nothing was proposed, so there is nothing to judge
 *   and the act is to **retry** — which is the existing add path run again for
 *   that word at its recorded Rhyme Key, never a second write path.
 * - **`agent-reading-failed-verification`** — a reading *was* proposed and
 *   `verifyReading` refused it, because it does not reach the target. That is
 *   the word's candidate honest reading, and it is offered to the editor through
 *   the approve card #180 already built (`web/src/editor/CorrectionView.tsx`),
 *   over the proposal `honestReading` turns it into. Approving it writes the
 *   reading, so the player is told the word does not rhyme rather than that it
 *   is not a word we know.
 *
 * ## Why the state is derived rather than the file being emptied
 *
 * The file is an **append-only record**, like the capture queue beside it: it is
 * what makes the composition's real miss rate countable (ADR-0014), and a
 * section that deleted the lines it had dealt with would forfeit that. So a
 * deferral whose word the engine now reads comes back `answered` and asks for
 * nothing, exactly as a Candidate whose word now rhymes comes back `resolved`.
 * A retry that landed and an approved honest reading are both that same fact —
 * the engine holds a reading it did not hold when the add was deferred — which
 * is why one test covers both and neither writes anything to say so.
 *
 * Nothing here opens a file. The records arrive parsed and the evidence context
 * arrives as an argument, which is what makes the whole of this callable over a
 * fixture with nothing on disk and no subprocess in flight — `readCandidateQueue`
 * and `readScheduledDay`'s own shape, for their reason.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isRhymeKeyShape } from "../src/declines.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import {
  gatherEvidence,
  type EvidenceContext,
  type ReadingEvidence,
} from "../src/supplementEvidence.ts";
import { parseReading } from "./editorReading.ts";

/** Why the add path could not write a reading. The add path's own two cases. */
export type DeferredReason = "agent-unavailable" | "agent-reading-failed-verification";

/**
 * One word the add path could not resolve, as `resolveAddOutcome` decided it and
 * before the append stamps it.
 *
 * `proposed` is the reading the agent authored and `verifyReading` refused, and
 * it is on the record because **the editor cannot judge a reading they cannot
 * see**. It was dropped on the way to the file until this slice, which made the
 * ticket's "offered to the editor with its reading visible" unsatisfiable from
 * the file's own contents — the outcome carried it, the record did not. It is
 * null for `agent-unavailable`, where there is nothing to carry.
 */
export interface DeferredReading {
  word: string;
  /** The Rhyme Key the add was aimed at, which is what a retry re-aims at. */
  rhymeKey: RhymeKey;
  reason: DeferredReason;
  proposed: Pronunciation | null;
}

/** One line of `data/deferred-readings.jsonl`: a deferral and when it happened. */
export interface DeferredRecord extends DeferredReading {
  /** ISO 8601, stamped by the append. */
  timestamp: string;
}

/** What every deferral carries, whatever state it is in. */
export interface DeferralIdentity {
  /** The word as the engine reads it — normalised, as the add path recorded it. */
  word: string;
  /** The Rhyme Key it was aimed at. A retry is aimed at this one, never a day's. */
  rhymeKey: RhymeKey;
  /** The record on file, unaltered. */
  record: DeferredRecord;
}

/**
 * One deferral with its state derived — the closed union the section renders and
 * the two acts dispatch on, in the shape `ReadCandidate` uses beside it.
 *
 * - **answered** — the engine holds a reading for this word now, which it did
 *   not when the add was deferred. Either the retry landed or the honest reading
 *   was approved; both are done, and nothing was written to say so.
 * - **unreached** — no reading, and none was proposed. The retry is the act.
 * - **proposed** — a reading was proposed and missed the target. The approve
 *   card is the act, and the only one: an agent that has already answered is not
 *   asked again (#180), because the second answer would be a different reading
 *   and the first is the one being judged.
 */
export type ReadDeferral =
  | (DeferralIdentity & { state: "answered"; readings: ReadingEvidence[] })
  | (DeferralIdentity & { state: "unreached" })
  | (DeferralIdentity & { state: "proposed"; proposed: Pronunciation });

/** The closed set of states, as names. */
export type DeferralState = ReadDeferral["state"];

/** True when a deferral still wants the editor. Only `answered` does not. */
export function isDeferralOutstanding(deferral: ReadDeferral): boolean {
  return deferral.state !== "answered";
}

/** The whole second section, read. */
export interface DeferredSection {
  /** One entry per word and Rhyme Key, oldest deferral first. */
  entries: readonly ReadDeferral[];
  /** How many still want the editor. */
  outstanding: number;
}

/**
 * The section a caller with no records at all gets — an empty section, never null.
 *
 * **Frozen, because it is one object shared by every caller of it.** It is
 * handed back by value rather than rebuilt, so a caller that pushed an entry
 * onto it would not be editing their own empty section but everyone's, for as
 * long as the process lived. The type is readonly to say so before the runtime
 * has to.
 */
export const NO_DEFERRALS: DeferredSection = Object.freeze({
  entries: Object.freeze([]),
  outstanding: 0,
});

/**
 * The deferred readings, with every state derived.
 *
 * **One entry per word and Rhyme Key, and the last record wins.** The file is
 * append-only, so a word retried and deferred a second time is two lines, and
 * showing both would present the editor with the same word twice and the older
 * proposal among them. Later in the file is later in time — which is a property
 * of an append rather than of a clock, so it is read off the order rather than
 * off the timestamp. The word is normalised into the key, because that is the
 * word the entry then *renders*: keying on the raw field would make two lines
 * differing only in case two entries showing the same word twice, and two React
 * children under one key.
 *
 * The pair is the identity in the **shape** a Decline's is (`declineKey`), for
 * the same reason — the same word deferred against two Rhyme Keys is two
 * different asks, and answering one says nothing about the other. It follows
 * that key rather than calling it: a deferral is not a ruling, and the two must
 * stay free to vary apart, which is the argument #176 makes for keeping the
 * Declines module out of the demotions.
 *
 * `ctx` is the pinned-source evidence context, an argument for `readCandidateQueue`'s
 * reason: it is what the `answered` check is made against, and taking it as an
 * argument is what makes this callable over a fixture.
 */
export function readDeferredSection(
  records: readonly DeferredRecord[],
  ctx: EvidenceContext,
): DeferredSection {
  const latest = new Map<string, DeferredRecord>();
  for (const record of records) {
    // A `Map` keeps the position of the first put and takes the value of the
    // last, which is the order and the winner this wants in one pass.
    latest.set(deferralKey(record), record);
  }

  const entries = [...latest.values()].map((record) => readDeferral(record, ctx));
  return { entries, outstanding: entries.filter(isDeferralOutstanding).length };
}

/**
 * What makes two lines the same ask: the word as the engine reads it, and the
 * Rhyme Key it was aimed at. The word goes through `normaliseWord` so the key
 * names the word the entry renders — `gatherEvidence` normalises too, and an
 * identity that disagreed with the display would show one word as two.
 */
function deferralKey(record: DeferredRecord): string {
  return `${normaliseWord(record.word)}\t${record.rhymeKey}`;
}

/**
 * One deferral's state, in the order the cases rule each other out.
 *
 * **Answered first**, because it is derived from the index's own inputs and
 * outranks anything the file remembers: a record saying the agent was
 * unreachable in June says nothing about a word the supplement has read since.
 * A deferral is only ever written for a word the add path found **no** reading
 * for — `resolveAddOutcome` reaches the agent only when `direct` is empty — so
 * "the engine reads this word now" is exactly "something has answered this
 * since", and it covers the landed retry and the approved honest reading
 * together without asking which happened.
 *
 * Then the proposal, if there is one to judge. A `agent-reading-failed-verification`
 * record with no reading on it is a line written before the reading was carried
 * to the file; there is nothing for the approve card to show, so it falls
 * through to the retry rather than drawing an empty card.
 */
function readDeferral(record: DeferredRecord, ctx: EvidenceContext): ReadDeferral {
  const evidence = gatherEvidence(record.word, record.rhymeKey, ctx);
  const identity: DeferralIdentity = { word: evidence.word, rhymeKey: record.rhymeKey, record };

  if (evidence.direct.length > 0) {
    return { ...identity, state: "answered", readings: evidence.direct };
  }

  if (record.reason === "agent-reading-failed-verification" && record.proposed !== null) {
    return { ...identity, state: "proposed", proposed: record.proposed };
  }

  return { ...identity, state: "unreached" };
}

/**
 * Parse the deferred file: one JSON object per line, and **a line that will not
 * read is dropped rather than thrown on**.
 *
 * That is this repository's convention for its captured JSONL — `parseCandidates`
 * (`src/supplementCandidate.ts`) does exactly this, and `parseDeclines` does it
 * for the rulings — and the argument is the same one: the alternative is a
 * section that will not render at all because one line of a scratch file is
 * malformed, over a file whose whole purpose is to be a work list. The committed
 * demotion list is the deliberate opposite, and stays that way: a demotion
 * changes adjudication, and losing one silently would change a verdict.
 *
 * A record with no `proposed` field reads as one with nothing proposed, which is
 * the shape every line written before #181 has.
 */
export function parseDeferredReadings(text: string): DeferredRecord[] {
  const out: DeferredRecord[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = toRecord(parsed);
    if (record !== null) out.push(record);
  }
  return out;
}

const REASONS: ReadonlySet<string> = new Set<DeferredReason>([
  "agent-unavailable",
  "agent-reading-failed-verification",
]);

/**
 * One parsed line as a record, or `null` when it is not one.
 *
 * A predicate would have to call a missing `proposed` a malformed line; this
 * builds the record instead, so the field the add path did not use to write can
 * be absent without costing the line. The Rhyme Key is checked against
 * `isRhymeKeyShape` — the same pattern the Declines parser and the Decline route
 * check against, rather than a third copy of it.
 */
function toRecord(value: unknown): DeferredRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { word, rhymeKey, reason, timestamp } = record;
  if (typeof word !== "string" || word === "") return null;
  if (typeof rhymeKey !== "string" || !isRhymeKeyShape(rhymeKey)) return null;
  if (typeof reason !== "string" || !REASONS.has(reason)) return null;
  if (typeof timestamp !== "string" || timestamp === "") return null;

  const proposed = toPronunciation(record["proposed"]);
  return { word, rhymeKey, reason: reason as DeferredReason, proposed, timestamp };
}

/**
 * A reading, or null — including for a line that never carried one.
 *
 * The shape a phoneme has to have is **`parseReading`'s**, not a third copy of
 * it. This file is the add path's own output read back, so what may be in it is
 * exactly what the add path was willing to write: judging it by a looser rule
 * here would let the section show the editor a reading the route that writes
 * pronunciation corrections would then refuse. The array is joined because
 * `parseReading` reads an agent's line; the elements are checked to be strings
 * first, so a number in the list cannot be stringified into a phoneme by the
 * join.
 *
 * The parse has to come back **unchanged** to be taken. `parseReading` upper-cases
 * and re-splits, which is right for an agent's stdout and wrong for a field the
 * add path wrote from an already-parsed reading: a line the parse had to tidy is
 * not a line this file wrote, and taking it would accept a token the
 * pronunciation-correction route refuses.
 */
function toPronunciation(value: unknown): Pronunciation | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((p) => typeof p === "string")) return null;
  const parsed = parseReading(value.join(" "));
  if (parsed === null || parsed.length !== value.length) return null;
  return parsed.every((phoneme, i) => phoneme === value[i]) ? parsed : null;
}
