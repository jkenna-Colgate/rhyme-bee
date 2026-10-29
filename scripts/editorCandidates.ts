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
 * A Candidate whose word is now an Answer on its Rhyme Key is resolved by that
 * fact alone: an Appeal says the word should have been an Answer, so a word
 * that merely rhymes there, as a Bonus Word does, is not resolved (#258).
 * Nothing is written and nothing is moved: a fix landing anywhere else in the
 * build (a Normalisation rule, a supplement entry, a coverage derivation, a
 * Tier verdict) clears the Candidate the next time this
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
 *
 * ## The second section rides on this readout rather than beside it
 *
 * The Candidate Queue is defined as the outstanding Candidates *and*, as a
 * second section, the readings the add path asked an agent for and did not get
 * (GLOSSARY.md, #181). So the readout carries both, and the one endpoint that
 * already answers with the whole queue answers with the whole queue. What that
 * section *is* stays in `./editorDeferred.ts` — a different file, a different
 * state union and a different act — and this module neither parses it nor
 * derives it; it is passed through, the way the schedule's days are.
 */

import { declineKey, declinedPairs, type Decline } from "../src/declines.ts";
import type { DemotionReason } from "../src/demotions.ts";
import { phonemesOf, readingReachesKey } from "../src/judge.ts";
import { ruledPairs, rulingKey, type JudgeRulingRecord } from "../src/judgeLanding.ts";
import { applyNormalisation } from "../src/normalise.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "../src/phonology.ts";
import { applyUnconfirmedRhymes, type UnconfirmedRhyme } from "../src/unconfirmedRhymes.ts";
import { nextDateOf, type Schedule, type ScheduleDay, type Weekday } from "../src/schedule.ts";
import type { SupplementCandidate } from "../src/supplementCandidate.ts";
import {
  gatherEvidence,
  type ComposedReading,
  type EvidenceContext,
  type ReadingEvidence,
  type RelativeEvidence,
} from "../src/supplementEvidence.ts";
import {
  readDeferredSection,
  type DeferredRecord,
  type DeferredSection,
} from "./editorDeferred.ts";

/**
 * What the queue reads each Candidate against: the evidence context, and
 * whether a word is an Answer today, with every standing Tier verdict applied
 * (`standingTierOf`), so a verdict written in the Editor's Pass resolves a
 * Candidate before the next build, as a reading written there does.
 */
export interface CandidateQueueContext extends EvidenceContext {
  isAnswer: (word: string) => boolean;
  /** The editor's calendar date, from which each group's next day is found (#257). */
  today: string;
}

/** What every Candidate carries, whatever state it is in. */
export interface CandidateIdentity {
  /** The word as the engine reads it — normalised, which is how it is captured. */
  word: string;
  /** The captured record, unaltered: the six fields and nothing added to them. */
  candidate: SupplementCandidate;
  /**
   * The Judge's ruling on this word and Rhyme Key, from `data/judge-rulings.jsonl`,
   * or null when the Judge has not ruled on it (#269). Shown beside the card so
   * the editor reads the Judge's reasons rather than ruling cold.
   */
  judged: JudgeRulingRecord | null;
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
 * The eight, and what each one means the editor should do:
 *
 * - **resolved**: the word is an Answer on this key today, with every standing
 *   Tier verdict applied. There is nothing to do, and nothing was written to
 *   say so.
 * - **declined** — a standing Decline names this word *and* this key. The
 *   editor has already ruled; the queue stops presenting it.
 * - **needs-tier**: the word rhymes on this key and holds the Bonus Word Tier.
 *   An Appeal says it should have been an Answer, so the ruling it wants is a
 *   Tier verdict, and it is resolved once one makes it an Answer (#258).
 * - **is-a-name** — the word is in the names data. Never valid, however well it
 *   rhymes (GLOSSARY.md), so the ruling it wants is the existing demote gesture
 *   and not a reading.
 * - **suggested-demotion**: the Judge's wordhood question found the word a name
 *   or not a word, so it landed nothing (#266) and arrives with that reason
 *   (#269). Making the Demotion is the editor's act; nothing is demoted here.
 * - **unconfirmed-rhyme**: the word and this key are a standing Unconfirmed
 *   Rhyme, so the game already accepts the word here without Points. The
 *   ruling it wants is the line's own: confirm it or Decline it. It carries the
 *   line, so the card offers exactly what the line's own card offers, and the
 *   day's Unconfirmed Rhymes leave the line out rather than show the pair twice.
 * - **needs-correction** — the engine holds a reading of its own for this word
 *   and that reading does not reach the target. A correction, which is slice 3.
 * - **addable** — the engine has no reading it can accept for this word. An add,
 *   aimed at the Rhyme Key exactly as adds already are.
 */
export type ReadCandidate =
  | (CandidateIdentity & { state: "resolved"; readings: ReadingEvidence[] })
  | (CandidateIdentity & { state: "declined" })
  | (CandidateIdentity & { state: "needs-tier"; readings: ReadingEvidence[] })
  | (CandidateIdentity & { state: "is-a-name" })
  | (CandidateIdentity & {
      state: "suggested-demotion";
      /** The Demotion the Judge's answer suggests: a name is a Proper Noun, a non-word is not a known word. */
      reason: DemotionReason;
    })
  | (CandidateIdentity & {
      state: "unconfirmed-rhyme";
      /** The standing line on this word and key, with what a Confirm offers. */
      listed: ReadUnconfirmedRhyme;
    })
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
  /**
   * The queue's second section: the readings the add path asked an agent for and
   * did not get (#181). Empty when the deferred file is — which is its state in
   * the repository today, and the good one.
   */
  deferred: DeferredSection;
  /**
   * Every Unconfirmed Rhyme that stands, each with the ruling that wrote it
   * (#269). On this readout rather than the day's for the second section's
   * reason: the day view narrows it to its own Rhyme Key, as it narrows the
   * Candidates, and the day readout does not grow.
   */
  unconfirmedRhymes: ReadUnconfirmedRhyme[];
}

/**
 * What the Judge left behind for the Editor's Pass (#266): its rulings, the
 * Unconfirmed Rhyme list, and the demoted words that overrule a line on it.
 */
export interface JudgeLeftovers {
  rulings: readonly JudgeRulingRecord[];
  /** `data/unconfirmed-rhymes.txt` as text. */
  unconfirmed: string;
  demotedWords: ReadonlySet<string>;
}

const NOTHING_FROM_THE_JUDGE: JudgeLeftovers = { rulings: [], unconfirmed: "", demotedWords: new Set() };

/** The Judge's reading of a listed word, read as the build reads a reading. */
export interface JudgeProposal {
  /** As the Judge wrote it, which is what a Confirm writes to the supplement. */
  phonemes: Pronunciation;
  /** Its Rhyme Key after Normalisation: the line's own when it reaches it. */
  key: RhymeKey | null;
  reaches: boolean;
}

/**
 * One standing Unconfirmed Rhyme, for the editor to confirm or Decline (#269).
 * Confirming it is the ordinary add of a reading: through the correction route
 * when there is a proposal or a reading of the engine's to correct, and through
 * the add path for a word with neither (`confirmGesture`,
 * `web/src/editor/judgeRuling.ts`). Declining it is the ordinary Decline, which
 * also takes the line off the list. A Candidate on the same pair carries it
 * (the `unconfirmed-rhyme` state), and the line is then shown on that card only.
 */
export interface ReadUnconfirmedRhyme {
  line: UnconfirmedRhyme;
  /** The ruling that wrote the line, or null for a line the record does not hold. */
  judged: JudgeRulingRecord | null;
  /** The engine's readings of the word today, the "before" of a Confirm. Empty for a Missing Reading. */
  readings: ReadingEvidence[];
  /** The Judge's reading, ready to confirm, or null when there is none to offer. */
  proposal: JudgeProposal | null;
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
 *
 * `deferred` is the second section's parsed records, and it defaults to none:
 * the section is read from a file of its own, so a caller asking about
 * Candidates alone gets an empty section rather than having to supply one.
 * Every state on it is `readDeferredSection`'s, derived against the same `ctx`
 * — one context for both sections, so a word cannot be answered in one and
 * outstanding in the other.
 */
export function readCandidateQueue(
  candidates: readonly SupplementCandidate[],
  schedule: Schedule,
  declines: readonly Decline[],
  ctx: CandidateQueueContext,
  deferred: readonly DeferredRecord[] = [],
  judge: JudgeLeftovers = NOTHING_FROM_THE_JUDGE,
): CandidateQueueReadout {
  const declined = declinedPairs(declines);
  const ruled = ruledPairs(judge.rulings);
  const dayFor = daysByRhymeKey(schedule, ctx.today);
  // Read before the Candidates rather than beside them, because a Candidate on a
  // listed pair takes its state from the line (`readCandidate`).
  const unconfirmedRhymes = readUnconfirmedRhymes(judge, declined, ruled, ctx);
  const listed = new Map(unconfirmedRhymes.map((u) => [rulingKey(u.line.word, u.line.rhymeKey), u]));

  const groups = new Map<RhymeKey, CandidateGroup>();
  let newest: string | null = null;

  for (const candidate of candidates) {
    const rhymeKey = candidate.seedRhymeKey;
    const read = readCandidate(candidate, declined, ruled, listed, ctx);

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
    deferred: readDeferredSection(deferred, ctx),
    unconfirmedRhymes,
  };
}

/**
 * The lines that stand, by the build's own rule (`applyUnconfirmedRhymes`): a
 * line whose word now rhymes by itself is stale, and one a Demotion names is
 * overruled. A line for a Declined pair is left out too, though a Decline takes
 * its line off the list as it is written: the screen should not offer a ruling
 * already made. Ordered by Rhyme Key, then word.
 */
function readUnconfirmedRhymes(
  judge: JudgeLeftovers,
  declined: ReadonlySet<string>,
  ruled: ReadonlyMap<string, JudgeRulingRecord>,
  ctx: CandidateQueueContext,
): ReadUnconfirmedRhyme[] {
  const { kept } = applyUnconfirmedRhymes(judge.unconfirmed, {
    rhymesByItself: (word, rhymeKey) => gatherEvidence(word, rhymeKey, ctx).rhymesDirectly,
    demotedWords: judge.demotedWords,
  });
  return kept
    .filter((line) => !declined.has(declineKey(line.word, line.rhymeKey)))
    .sort((a, b) => a.rhymeKey.localeCompare(b.rhymeKey) || a.word.localeCompare(b.word))
    .map((line) => {
      const judged = ruled.get(rulingKey(line.word, line.rhymeKey)) ?? null;
      return {
        line,
        judged,
        readings: gatherEvidence(line.word, line.rhymeKey, ctx).direct,
        proposal: judgeProposal(judged?.reading ?? null, line.rhymeKey),
      };
    });
}

/** The Judge's reading as a proposal, its key read after Normalisation as the build reads it. */
function judgeProposal(reading: string | null, target: RhymeKey): JudgeProposal | null {
  const phonemes = phonemesOf(reading);
  if (phonemes === null) return null;
  const pronunciations = new Map([["", [phonemes]]]);
  applyNormalisation({ pronunciations });
  const keys = pronunciations.get("")!.map(rhymeKeyOf);
  const reaches = readingReachesKey(reading, target);
  return { phonemes, key: reaches ? target : (keys.find((k) => k !== null) ?? null), reaches };
}

/**
 * One Candidate's state, in the order the cases can rule each other out.
 *
 * **Resolved first**, before any standing Decline, because resolution is derived
 * and a ruling made against an older index is stale the moment the word starts
 * rhyming. A Decline is the editor agreeing with a rejection; a word the engine
 * now accepts is not being rejected at all, so there is nothing left to agree
 * with. Resolution is the engine's own Answer test, not merely the rhyme:
 * `rhymesDirectly` alone would call a word with no wordhood resolved while the
 * player went on being refused it, and would call a Bonus Word resolved on
 * arrival, though its Appeal says it should have been an Answer (#258).
 *
 * **Then the Decline, then a name**, below.
 *
 * **Then a word that rhymes and is not an Answer**, which wants a Tier verdict
 * and not a reading.
 *
 * A name is excluded from that test rather than ordered around it. A name is
 * never valid however well it rhymes (GLOSSARY.md), which is `resolveAddOutcome`'s
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
 * **Then a name**, whose ruling is a demotion rather than a reading, and then
 * a word the Judge found to be a name or not a word, for the same ruling with
 * the Judge's reason. A suggested Demotion is settled as a name is: by the
 * Demotion and a `reason-is-correct` Decline, the second taking it off the queue.
 *
 * **Then a standing Unconfirmed Rhyme**, whose ruling is the line's: confirm it
 * or Decline it. It comes after the two name cases because a name is never
 * valid however the Judge heard it, and a Demotion overrules the line anyway.
 * It comes before the three below because each of them would offer a second
 * gesture for a pair that already has one: the line is what the Judge left, and
 * a Candidate card that asked for a Tier, a correction or an add beside it
 * would be the same pair on the screen twice, ruled two ways. In practice the
 * Tier case cannot meet a line at all, since a word that rhymes by itself makes
 * its line stale (`readUnconfirmedRhymes`).
 *
 * **Then the two that want a reading.** `direct` and `relatives`/`composed` are
 * mutually exclusive by `gatherEvidence`'s own construction — a word that
 * already reads is a correction and is never offered relatives — so the split
 * below is total and each card gets the evidence its own case turns on.
 */
function readCandidate(
  candidate: SupplementCandidate,
  declined: ReadonlySet<string>,
  ruled: ReadonlyMap<string, JudgeRulingRecord>,
  listed: ReadonlyMap<string, ReadUnconfirmedRhyme>,
  ctx: CandidateQueueContext,
): ReadCandidate {
  const evidence = gatherEvidence(candidate.word, candidate.seedRhymeKey, ctx);
  const judged = ruled.get(rulingKey(evidence.word, candidate.seedRhymeKey)) ?? null;
  const identity: CandidateIdentity = { word: evidence.word, candidate, judged };

  const rhymes = evidence.isWord && !evidence.isName && evidence.rhymesDirectly;
  if (rhymes && ctx.isAnswer(evidence.word)) {
    return { ...identity, state: "resolved", readings: evidence.direct };
  }

  if (declined.has(declineKey(evidence.word, candidate.seedRhymeKey))) {
    return { ...identity, state: "declined" };
  }

  if (evidence.isName) return { ...identity, state: "is-a-name" };

  if (judged?.landed === "suggested-demotion") {
    return { ...identity, state: "suggested-demotion", reason: judged.wordhood?.verdict === "name" ? "proper-noun" : "not-a-known-word" };
  }

  const line = listed.get(rulingKey(evidence.word, candidate.seedRhymeKey));
  if (line !== undefined) return { ...identity, state: "unconfirmed-rhyme", listed: line };

  if (rhymes) return { ...identity, state: "needs-tier", readings: evidence.direct };

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
 * The schedule's days, by the Rhyme Key each was dealt on, each dated by the
 * next time it plays on or after `today` (#257). The listed date is the first
 * lap's, and once that lap has gone every listed date is past, so "soonest
 * first" would stop meaning anything. A day that will not play again (the spare
 * in front of the lap, once its date has gone) names no day at all.
 *
 * The run holds 260 days over 260 distinct Rhyme Keys, so a key reaches at most
 * one day. Should two ever share one, the first wins and the second is simply
 * not named here — a group carrying the wrong one of two days would be worse
 * than a group carrying the earlier of them, and the schedule is a reviewed
 * artifact (ADR-0012) where a duplicate key is a defect to fix rather than a
 * case to design for.
 */
function daysByRhymeKey(schedule: Schedule, today: string): ReadonlyMap<RhymeKey, CandidateDay> {
  const days = new Map<RhymeKey, CandidateDay>();
  for (const day of schedule.days) {
    if (days.has(day.rhymeKey)) continue;
    const date = nextDateOf(schedule, day, today);
    if (date !== null) days.set(day.rhymeKey, toCandidateDay(day, date));
  }
  return days;
}

function toCandidateDay(day: ScheduleDay, date: string): CandidateDay {
  return { date, weekday: day.weekday, week: day.week, seed: day.seed };
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
