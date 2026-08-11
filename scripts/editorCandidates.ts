/**
 * The **Candidate Queue** as a *value*: every outstanding Candidate grouped by
 * Rhyme Key, each group carrying the scheduled day the schedule holds for that
 * key, and every Candidate carrying a state nobody had to rule on to produce.
 *
 * This is the deep module of #176 and the whole of slice 1 (#177). One function
 * takes the parsed queue, the schedule, the standing Declines and an evidence
 * context, and returns the readout. The endpoint that serves it and the view
 * that draws it **decide nothing** — without this, the resolved check lands in
 * the view, the Decline lookup lands in the endpoint, and the
 * add-versus-correct determination lands in both, plus every test.
 *
 * It follows the shape `readScheduledDay` (`./editorDay.ts`) established: the
 * evidence context arrives as an *argument* rather than being read here, which
 * is what makes the whole of this callable over a fixture with nothing on disk.
 * Nothing in this module opens a file, and nothing in it writes one — this
 * slice writes no file at all, and no gesture on the screen it feeds changes
 * anything on disk.
 *
 * ## Resolution is derived, never stored
 *
 * A Candidate whose word the engine would now accept on its Rhyme Key is
 * resolved by that fact alone. Nothing is written and nothing is moved: a fix
 * landing anywhere else in the build — a Normalisation rule, a supplement
 * entry, a coverage derivation — clears the Candidate the next time this
 * function runs. That is what retires the five cot–caught Candidates
 * (`talked`, `hawked`, `walked`, `balked`, `stalked`, Appealed against
 * `docked`) on first render, having been fixed when the merger landed and
 * carried as outstanding work ever since because clearing the queue was a
 * manual archive step nobody ran.
 *
 * The only thing an editor writes is a **Decline** (`src/declines.ts`), keyed
 * on the word and the Rhyme Key together, and slice 2 is what writes it.
 *
 * ## Why the group is the Rhyme Key and the day is the passenger
 *
 * A Candidate is aimed at a Rhyme Key: that is what it claims to rhyme on, and
 * two Candidates raised from two different Seed Words on one key are the same
 * rhyme family and want judging together. The live case is `docked` (Free Play,
 * no date at all) and `shellshocked` (a scheduled Daily Puzzle) sharing
 * `AA K T`. Grouping by Seed Word would split them; grouping by day would show
 * nothing on 255 days out of 260 and would never show the 17 of 33 standing
 * Candidates whose key the schedule does not hold at all.
 *
 * So a group whose key the schedule has no day for stands on its own rather
 * than being dropped, and the day panel is a *filter* over this one readout
 * (`web/src/editor/dayCandidates.ts`) rather than a second delivery. The day
 * readout's own payload does not grow: a fact about Candidates is not a fact
 * about the day.
 */

import { declineKey, declinedPairs, type Decline } from "../src/declines.ts";
import type { RhymeKey } from "../src/phonology.ts";
import type { Schedule, ScheduleDay, Weekday } from "../src/schedule.ts";
import type { SupplementCandidate } from "../src/supplementCandidate.ts";
import {
  gatherEvidence,
  type ComposedReading,
  type EvidenceContext,
  type ReadingEvidence,
  type RelativeEvidence,
} from "../src/supplementEvidence.ts";

/** What every Candidate carries, whatever state it is in. */
export interface CandidateIdentity {
  /** The word as the engine reads it — normalised, which is how it is captured. */
  word: string;
  /** The captured record, unaltered: the six fields and nothing added to them. */
  candidate: SupplementCandidate;
}

/**
 * One Candidate with its state already derived — the closed union the view
 * renders and the acts of slices 2 to 4 dispatch on.
 *
 * Flat, with `state` as the discriminant, which is the shape `AddOutcome`
 * (`web/src/editor/addOutcome.ts`) already uses for the same job: each case
 * carries the evidence *its own* case turns on and not the rest, so a card can
 * be written against one variant without reaching for fields that mean nothing
 * to it.
 *
 * The five, and what each one means the editor should do:
 *
 * - **resolved** — the engine would accept this word on this key today. There
 *   is nothing to do, and nothing was written to say so.
 * - **declined** — a standing Decline names this word *and* this key. The
 *   editor has already ruled; the queue stops presenting it.
 * - **is-a-name** — the word is in the names data. Never valid, however well it
 *   rhymes (CONTEXT.md), so the ruling it wants is the existing demote gesture
 *   and not a reading.
 * - **needs-correction** — the engine holds a reading of its own for this word
 *   and that reading does not reach the target. A correction, which is slice 3.
 * - **addable** — the engine has no reading it can accept for this word. An add,
 *   aimed at the Rhyme Key exactly as adds already are.
 */
export type ReadCandidate =
  | (CandidateIdentity & { state: "resolved"; readings: ReadingEvidence[] })
  | (CandidateIdentity & { state: "declined" })
  | (CandidateIdentity & { state: "is-a-name" })
  | (CandidateIdentity & { state: "needs-correction"; readings: ReadingEvidence[] })
  | (CandidateIdentity & {
      state: "addable";
      /**
       * The word's own readings. Empty for the ordinary add — a word the pinned
       * sources do not read at all — and non-empty only where the word *does*
       * read on the target but has no wordhood, which the supplement is the
       * only layer that can grant (ADR-0009).
       */
      readings: ReadingEvidence[];
      /** Inflectional relatives a derived reading could be built from. */
      relatives: RelativeEvidence[];
      /** A reading composed from a compound split, when one reaches the target. */
      composed: ComposedReading | null;
    });

/** The closed set of states, as names. */
export type CandidateState = ReadCandidate["state"];

/**
 * The two states that need no ruling. Everything else is outstanding — which is
 * counted rather than filtered out, because a group that has been fully judged
 * should read as *done* rather than vanish and leave the editor wondering
 * whether they imagined it.
 */
const SETTLED: ReadonlySet<CandidateState> = new Set<CandidateState>(["resolved", "declined"]);

/** True when a Candidate still wants a ruling from the editor. */
export function isOutstanding(candidate: ReadCandidate): boolean {
  return !SETTLED.has(candidate.state);
}

/**
 * The scheduled day a group's Rhyme Key belongs to, when the schedule holds one.
 *
 * Deliberately not a `ScheduleDay`: the recorded answer count and Difficulty are
 * figures about the *day*, they are the day readout's to report, and carrying
 * them here would be a second place they could be read from and disagree.
 */
export interface CandidateDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  weekday: Weekday;
  /** 1-based, for reading the schedule rather than for any behaviour. */
  week: number;
  seed: string;
}

/** Every Candidate aimed at one Rhyme Key, and the day that key belongs to. */
export interface CandidateGroup {
  rhymeKey: RhymeKey;
  /**
   * The scheduled day for this Rhyme Key, or `null` when the schedule holds
   * none — which is the common case, since an Appeal raised in Free Play
   * carries a Seed Word the schedule never had. A group with no day is a group
   * that stands on its own, never a group that is dropped.
   */
  day: CandidateDay | null;
  /**
   * Every Seed Word these Candidates were raised against, in first-seen order.
   * More than one is two Puzzles' players Appealing into one rhyme family, and
   * is the concrete reason the group is the key rather than the Seed.
   */
  seedWords: string[];
  candidates: ReadCandidate[];
  /** How many of them still want a ruling. */
  outstanding: number;
}

/** The whole queue, read. */
export interface CandidateQueueReadout {
  groups: CandidateGroup[];
  /** Every Candidate on the queue, settled ones included. */
  total: number;
  /** How many across every group still want a ruling. */
  outstanding: number;
  /**
   * The newest Candidate's timestamp (ISO 8601), or `null` for an empty queue.
   *
   * On the readout so that a list which is stale because nobody has pulled from
   * R2 *looks* stale rather than empty. The pull stays a CLI step run before the
   * dev server (#176), so the screen has no way to know it is behind except by
   * saying how old the newest thing it holds is.
   */
  newest: string | null;
}

/**
 * The Candidate Queue, grouped, dated and with every state derived.
 *
 * `candidates` is the parsed queue, in whatever order it was appended;
 * `declines` is the standing rulings; `ctx` is the pinned-source evidence
 * context, which is the one thing here that stands in for the Rhyme Index and
 * is an argument for the reason `readScheduledDay`'s index is one.
 *
 * The evidence context rather than the index itself, because the question asked
 * of each Candidate is exactly `gatherEvidence`'s: wordhood, name status, the
 * word's own readings and — when it has none — its inflectional relatives and
 * any composable reading. That is both the resolved check *and* the
 * add-versus-correct-versus-name determination, from one call, under the same
 * Normalisation the index build applies (`evidenceContextFrom`), so a Rhyme Key
 * computed here and one taken from the built artifact are computed under one
 * phonology rather than two.
 */
export function readCandidateQueue(
  candidates: readonly SupplementCandidate[],
  schedule: Schedule,
  declines: readonly Decline[],
  ctx: EvidenceContext,
): CandidateQueueReadout {
  const declined = declinedPairs(declines);
  const dayFor = daysByRhymeKey(schedule);

  const groups = new Map<RhymeKey, CandidateGroup>();
  let newest: string | null = null;

  for (const candidate of candidates) {
    const rhymeKey = candidate.seedRhymeKey;
    const read = readCandidate(candidate, declined, ctx);

    let group = groups.get(rhymeKey);
    if (group === undefined) {
      group = {
        rhymeKey,
        day: dayFor.get(rhymeKey) ?? null,
        seedWords: [],
        candidates: [],
        outstanding: 0,
      };
      groups.set(rhymeKey, group);
    }
    if (!group.seedWords.includes(candidate.seedWord)) group.seedWords.push(candidate.seedWord);
    group.candidates.push(read);
    if (isOutstanding(read)) group.outstanding += 1;

    // ISO 8601 instants sort lexicographically, which is why the queue's key
    // format writes them the way it does (`candidateKey`).
    if (newest === null || candidate.timestamp > newest) newest = candidate.timestamp;
  }

  const ordered = [...groups.values()].sort(byUrgency);
  for (const group of ordered) {
    group.candidates.sort((a, b) => a.candidate.timestamp.localeCompare(b.candidate.timestamp) || a.word.localeCompare(b.word));
  }

  return {
    groups: ordered,
    total: candidates.length,
    outstanding: ordered.reduce((n, group) => n + group.outstanding, 0),
    newest,
  };
}

/**
 * One Candidate's state, in the order the cases can rule each other out.
 *
 * **Resolved first**, before any standing Decline, because resolution is derived
 * and a ruling made against an older index is stale the moment the word starts
 * rhyming. A Decline is the editor agreeing with a rejection; a word the engine
 * now accepts is not being rejected at all, so there is nothing left to agree
 * with. Resolution is the engine's own acceptance test, not merely the rhyme:
 * `rhymesDirectly` alone would call a word with no wordhood resolved while the
 * player went on being refused it.
 *
 * A name is excluded from that test rather than ordered around it. A name is
 * never valid however well it rhymes (CONTEXT.md), which is `resolveAddOutcome`'s
 * own first branch (`scripts/editorAdd.ts`) and the same rule for the same
 * reason, so a Candidate whose word is a name is never *resolved* by rhyming —
 * that is what keeps the case the demotion list exists for, a word carrying both
 * wordhood and name-hood which the engine accepts today, in front of the editor
 * instead of silently retired.
 *
 * **Then the Decline, and before the name check rather than after it.** A
 * demotion does not change `evidence.isName`, so a name Candidate left below the
 * name branch could never be settled by any gesture at all: it would read
 * `is-a-name` on every render for ever, having already been ruled on. The
 * Declines file is the one place that ruling can be written, so the queue has to
 * consult it before deciding a Candidate is nothing but a name. A ruling the
 * queue cannot honour is not a ruling.
 *
 * **Then a name**, whose ruling is a demotion rather than a reading.
 *
 * **Then the two that want a reading.** `direct` and `relatives`/`composed` are
 * mutually exclusive by `gatherEvidence`'s own construction — a word that
 * already reads is a correction and is never offered relatives — so the split
 * below is total and each card gets the evidence its own case turns on.
 */
function readCandidate(
  candidate: SupplementCandidate,
  declined: ReadonlySet<string>,
  ctx: EvidenceContext,
): ReadCandidate {
  const evidence = gatherEvidence(candidate.word, candidate.seedRhymeKey, ctx);
  const identity: CandidateIdentity = { word: evidence.word, candidate };

  if (evidence.isWord && !evidence.isName && evidence.rhymesDirectly) {
    return { ...identity, state: "resolved", readings: evidence.direct };
  }

  if (declined.has(declineKey(evidence.word, candidate.seedRhymeKey))) {
    return { ...identity, state: "declined" };
  }

  if (evidence.isName) return { ...identity, state: "is-a-name" };

  if (evidence.direct.length > 0 && !evidence.rhymesDirectly) {
    return { ...identity, state: "needs-correction", readings: evidence.direct };
  }

  return {
    ...identity,
    state: "addable",
    readings: evidence.direct,
    relatives: evidence.relatives,
    composed: evidence.composed,
  };
}

/**
 * The schedule's days, by the Rhyme Key each was dealt on.
 *
 * The run holds 260 days over 260 distinct Rhyme Keys, so a key reaches at most
 * one day. Should two ever share one, the first wins and the second is simply
 * not named here — a group carrying the wrong one of two days would be worse
 * than a group carrying the earlier of them, and the schedule is a reviewed
 * artifact (ADR-0012) where a duplicate key is a defect to fix rather than a
 * case to design for.
 */
function daysByRhymeKey(schedule: Schedule): ReadonlyMap<RhymeKey, CandidateDay> {
  const days = new Map<RhymeKey, CandidateDay>();
  for (const day of schedule.days) {
    if (!days.has(day.rhymeKey)) days.set(day.rhymeKey, toCandidateDay(day));
  }
  return days;
}

function toCandidateDay(day: ScheduleDay): CandidateDay {
  return { date: day.date, weekday: day.weekday, week: day.week, seed: day.seed };
}

/**
 * Group order: what wants work first, then what is soonest, then the key.
 *
 * A group with nothing outstanding has been worked and drops below the ones that
 * have not, however early its day. Within each half a scheduled group leads a
 * dateless one and the earlier date leads the later, because a Candidate against
 * a day that is nearly here is the one an Editor's Pass can still act on. The
 * Rhyme Key breaks the remaining ties so the order is stable across reads rather
 * than dependent on the queue's append order.
 */
function byUrgency(a: CandidateGroup, b: CandidateGroup): number {
  const worked = Number(a.outstanding === 0) - Number(b.outstanding === 0);
  if (worked !== 0) return worked;
  const dated = Number(a.day === null) - Number(b.day === null);
  if (dated !== 0) return dated;
  if (a.day !== null && b.day !== null && a.day.date !== b.day.date) {
    return a.day.date.localeCompare(b.day.date);
  }
  return a.rhymeKey.localeCompare(b.rhymeKey);
}
