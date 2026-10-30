/**
 * A **Batch** (GLOSSARY.md, ADR-0021) as rules: the maintainer's sitting that
 * checks a block of Seed Words for Trust before their dates (#267). This module
 * calls no model, reads no file and writes none; `scripts/batch.ts` does all
 * three, and everything it decides is decided here.
 *
 * ## A run that misheard
 *
 * The Synthetic Player reads the Seed Word as text, and now and then it hears
 * another word: Sonnet on `laird` typed `bird, heard, word`. Such a run finds
 * almost no Trust failures and says nothing about the day (#252). It is told by
 * the Rhyme Keys of the words it typed: when the most common other key
 * outnumbers the Seed Word's own by more than five to one, the run misheard.
 * Over 275 runs the mishearings sat at 8 or more and the healthy runs at 1.3 or
 * less, so the line falls in a gap. An off-key run is played again once; if the
 * second is off key too, the day's Trust is **untested**, neither a pass nor a
 * fail, and nothing swaps the Seed Word.
 *
 * ## The Trust gate
 *
 * Each **look** is one Synthetic Player run. Every Submission a look does not
 * count as an Answer is a Candidate, and the Judge rules on it and its ruling
 * lands (#266) before the index is rebuilt for the next look. The gate is
 * checked after a fix, never before (#225): a day passes on the first look after
 * the first that finds at most `k` Trust failures, and fails if `n` looks pass
 * without one. A day that fails ships anyway, counted as failed.
 */

import { normaliseWord } from "./cmudict.ts";
import { RHYME_BATCH, WORDHOOD_BATCH, type RhymeVerdict } from "./judge.ts";
import type { Landed } from "./judgeLanding.ts";
import type { RhymeKey } from "./phonology.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";
import { addDays, isCalendarDate, scheduledDayFor, type Schedule } from "./schedule.ts";

// ---- the block -----------------------------------------------------------------

/** One Seed Word of a Batch. */
export interface BatchSeed {
  /** The first date in the range that plays it. Null for a word named rather than scheduled. */
  date: string | null;
  seedWord: string;
  rhymeKey: RhymeKey;
  /** Whether players have had it already: its listed date is before today. */
  played: boolean;
}

/**
 * The Seed Words a Batch over a date range checks, in the order it checks them
 * (ADR-0021): date order, with the Seed Words already played last, since a day
 * still to come is the one that ships unchecked. A date past the listed days is
 * read through the loop, and each Seed Word is named once. A date the Schedule
 * does not reach is refused, so a Batch never leaves a gap it does not mention.
 */
export function batchBlock(schedule: Schedule, from: string, to: string, today: string): BatchSeed[] {
  for (const d of [from, to]) if (!isCalendarDate(d)) throw new Error(`"${d}" is not a calendar date`);
  if (to < from) throw new Error(`the range runs backwards: ${from} to ${to}`);
  const seen = new Set<string>();
  const block: BatchSeed[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = scheduledDayFor(schedule, date);
    if (!day) throw new Error(`the Schedule has no day for ${date}`);
    if (seen.has(day.seed)) continue;
    seen.add(day.seed);
    block.push({ date, seedWord: day.seed, rhymeKey: day.rhymeKey, played: day.date < today });
  }
  return [...block.filter((s) => !s.played), ...block.filter((s) => s.played)];
}

/**
 * The Seed Words of a Batch named by the maintainer rather than read off the
 * Schedule: the way a word that holds no place gets a Batch at all, which is
 * what growing the Schedule asks of every word joining it (#271). Each is
 * written `word` or `word=RHYME KEY`. A word with one Rhyme Key is played on
 * it; one with several on the key stated, or else on the one whose family holds
 * the most Answers, as the Continuity repair ranks a word's keys. A word that
 * does not pin there is refused before anything is called. It has no date and
 * has not been played.
 */
export function namedBlock(asked: readonly string[], index: RhymeIndex): BatchSeed[] {
  const block: BatchSeed[] = [];
  for (const entry of asked) {
    const at = entry.indexOf("=");
    const seedWord = normaliseWord(at < 0 ? entry : entry.slice(0, at));
    const stated = at < 0 ? undefined : entry.slice(at + 1).trim();
    if (block.some((s) => s.seedWord === seedWord)) continue;
    const answersOn = (key: RhymeKey) => index.familyOf(key).members.filter((m) => m.tier === "answer").length;
    const rhymeKey = stated ?? [...index.rhymeKeysOf(seedWord)].sort((a, b) => answersOn(b) - answersOn(a))[0];
    if (rhymeKey === undefined) throw new Error(`${seedWord} has no reading, so it has no Rhyme Key to play a Batch on`);
    index.pinSeed(seedWord, rhymeKey); // throws, naming the word, when it does not pin there
    block.push({ date: null, seedWord, rhymeKey, played: false });
  }
  return block;
}

// ---- off key -------------------------------------------------------------------

/** The off-key line: more than this many words on another key per word on the Seed Word's own. */
export const DEFAULT_OFF_KEY_RATIO = 5;

export interface KeyCount {
  /** The words typed that have a reading, which are the only ones counted. */
  withReading: number;
  /** Those with the Seed Word's Rhyme Key among their keys. */
  onKey: number;
  /** The most common other Rhyme Key among the rest, and how many words have it. */
  topOther: { rhymeKey: RhymeKey; words: number } | null;
  /** Whether the run misheard: `topOther` outnumbers `onKey` by more than the ratio. */
  offKey: boolean;
}

/**
 * Which Rhyme Keys a run's words fell on. A word that has the Seed Word's key
 * counts as on key only, since it is a Rhyme whatever else it is (`read` for
 * `bed`); a word with no reading is not counted at all. With nothing on key and
 * anything off it, the run is off key; with no word read at all, it is not.
 */
export function keyCount(
  words: readonly string[],
  seedKey: RhymeKey,
  keysOf: (word: string) => readonly RhymeKey[],
  ratio: number = DEFAULT_OFF_KEY_RATIO,
): KeyCount {
  let withReading = 0;
  let onKey = 0;
  const others = new Map<RhymeKey, number>();
  for (const word of new Set(words)) {
    const keys = keysOf(word);
    if (keys.length === 0) continue;
    withReading++;
    if (keys.includes(seedKey)) onKey++;
    else for (const k of new Set(keys)) others.set(k, (others.get(k) ?? 0) + 1);
  }
  const top = [...others].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const topOther = top ? { rhymeKey: top[0], words: top[1] } : null;
  return { withReading, onKey, topOther, offKey: topOther !== null && topOther.words > ratio * onKey };
}

/** What a look does after a run: keep it, play it again, or give the day up as untested. */
export type LookAttempt = "keep" | "re-run" | "untested";

/**
 * The re-run-once rule, given whether each run of one look so far was off key.
 * An on-key run is kept. An off-key first run is played again; an off-key
 * re-run makes the day untested, and there is no third run.
 */
export function lookAttempt(offKey: readonly boolean[]): LookAttempt {
  if (offKey.length === 0) throw new Error("a look has no run to decide on yet");
  if (!offKey[offKey.length - 1]) return "keep";
  return offKey.length === 1 ? "re-run" : "untested";
}

// ---- the Trust gate ------------------------------------------------------------

/** One Candidate of a look, with the Judge's ruling on it: made in this look, or read back from its record. */
export interface LookCandidate {
  word: string;
  /** Absent for a Candidate the Judge was not asked about. */
  ruling?: { verdict: RhymeVerdict; reachesKey: boolean; landed?: Landed };
}

/**
 * The Trust failures a look found: Candidates the Judge rules a Rhyme, with a
 * reading that reaches the key (#225). Two kinds are left out because the game
 * is right not to score them: an Unconfirmed Rhyme, which by the maintainer's
 * ruling on #225 (2026-10-09) is no obvious rhyme, and a word the Judge finds
 * is a name or not a word. A Candidate ruled on before counts the same way, so
 * a known failure left alone is found again by every look that types it.
 */
export function trustFailures(candidates: readonly LookCandidate[]): string[] {
  return candidates
    .filter(({ ruling: r }) => r?.verdict === "rhyme" && r.reachesKey && r.landed !== "unconfirmed-rhyme" && r.landed !== "suggested-demotion")
    .map((c) => c.word);
}

/** The gate's two settings. No value is claimed for either (#225): they are tuned over Batches. */
export interface TrustGate {
  /** The most Trust failures a passing look may find. */
  k: number;
  /** The most looks a day is given, the first included. */
  n: number;
}

/** Where the gate's settings start: three looks, as the cost in #267 is stated, and one failure. */
export const DEFAULT_TRUST_GATE: TrustGate = { k: 1, n: 3 };

/** A day's Trust: passed, failed, or untested because every look at it misheard the Seed Word. */
export type TrustResult = "pass" | "fail" | "untested";

/**
 * The gate's verdict on a day, from the Trust failures each look found, the
 * first look first. The first look comes before any fix, so it never passes the
 * day (#225). A later look that finds at most `k` passes it; the `n`th that
 * finds more fails it. Until then, look again.
 */
export function trustVerdict(failuresPerLook: readonly number[], gate: TrustGate): "pass" | "fail" | "look-again" {
  if (gate.n < 2) throw new Error(`n is ${gate.n}: the gate needs a look after the first, which comes before any fix`);
  if (failuresPerLook.length === 0) throw new Error("no look has been played");
  if (failuresPerLook.length > gate.n) throw new Error(`${failuresPerLook.length} looks played, over n = ${gate.n}`);
  if (failuresPerLook.length === 1) return "look-again";
  if (failuresPerLook[failuresPerLook.length - 1]! <= gate.k) return "pass";
  return failuresPerLook.length === gate.n ? "fail" : "look-again";
}

// ---- the cost ------------------------------------------------------------------

/** What a Batch's calls depend on, known before any is made. */
export interface BatchCallPlan {
  seeds: number;
  gate: TrustGate;
  /** The most rhyme calls the Judge may make on one look before the Batch stops. */
  maxJudgeCalls: number;
  /** The No False Accepts hunt's calls, as counted on the index before the looks. */
  hunt: { rhyme: number; wordhood: number };
}

/** The calls a Batch makes on one model, at fewest and at most. */
export interface ModelCost {
  model: string;
  fewest: number;
  most: number;
  /** An Opus run needs its cost stated and the maintainer's yes (#267). */
  opus: boolean;
}

export const isOpus = (model: string): boolean => /opus/.test(model);

/**
 * The calls a Batch will make, per model: every call is on the maintainer's
 * subscription, so this is its cost. The Synthetic Player plays every Seed
 * Word at least twice (the gate needs a look after the first) and at most `n`
 * looks of two runs each. The Judge may be asked nothing on the looks, and at
 * most `maxJudgeCalls` rhyme calls a look with a wordhood call per 20 of the
 * Candidates those hold; the hunt's calls come on top.
 */
export function batchCost(plan: BatchCallPlan, models: { player: string; judge: string }): ModelCost[] {
  const hunt = plan.hunt.rhyme + plan.hunt.wordhood;
  const perLook = plan.maxJudgeCalls + Math.ceil((plan.maxJudgeCalls * RHYME_BATCH) / WORDHOOD_BATCH);
  const legs = [
    { model: models.player, fewest: plan.seeds * 2, most: plan.seeds * plan.gate.n * 2 },
    { model: models.judge, fewest: hunt, most: hunt + plan.gate.n * perLook },
  ];
  const costs: ModelCost[] = [];
  for (const leg of legs) {
    const same = costs.find((c) => c.model === leg.model);
    if (same) {
      same.fewest += leg.fewest;
      same.most += leg.most;
    } else {
      costs.push({ ...leg, opus: isOpus(leg.model) });
    }
  }
  return costs;
}

// ---- the record ----------------------------------------------------------------

/**
 * One Batch a Seed Word went through. The record is what says a Seed Word has
 * been checked at all: one with no entry has not been (GLOSSARY.md, Batch), and
 * adding weeks reads it (#271).
 */
export interface BatchEntry {
  /** The day the Batch was run. */
  date: string;
  /** The Rhyme Key it was played on. */
  rhymeKey: RhymeKey;
  trust: TrustResult;
  /** The Trust failures each look found, the first look first. Empty for a day untested on its first look. */
  failuresPerLook: number[];
  gate: TrustGate;
  playerModel: string;
  judgeModel: string;
  /** The run report, from the repository root. */
  report: string;
  /** The No False Accepts hunt's result on the day (#268). Absent when the hunt did not run. */
  noFalseAccepts?: NoFalseAcceptsEntry;
}

/** The No False Accepts gate on one Seed Word, as the record keeps it (`src/noFalseAccepts.ts`). */
export interface NoFalseAcceptsEntry {
  result: "pass" | "fail";
  /** Scored Answers the hunt put to the Judge. */
  hunted: number;
  /** Of those, how many went on the ruling list. */
  listed: number;
  /** Listed Answers the maintainer did not rule on. */
  unruled: string[];
  /** Answers corrected or demoted that the rebuilt index still scored. */
  stillScored: string[];
}

const strings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === "string");

function isNoFalseAccepts(e: unknown): e is NoFalseAcceptsEntry {
  const x = e as Partial<NoFalseAcceptsEntry> | null;
  return !!x && (x.result === "pass" || x.result === "fail") && typeof x.hunted === "number" && typeof x.listed === "number" && strings(x.unruled) && strings(x.stillScored);
}

/** `data/batches.json`: every Seed Word that has been through a Batch, and each Batch's result. */
export interface BatchRecord {
  seeds: Record<string, BatchEntry[]>;
}

const NOTE =
  "Which Seed Words have been through a Batch, and with what result (#267). Written by the batch command; " +
  "a Seed Word with no entry has not been checked. Each Batch's run report is in data/judge-runs/.";

const RESULTS: readonly string[] = ["pass", "fail", "untested"];

function isEntry(e: unknown): e is BatchEntry {
  const x = e as Partial<BatchEntry> | null;
  return (
    !!x &&
    typeof x.date === "string" &&
    typeof x.rhymeKey === "string" &&
    RESULTS.includes(x.trust as string) &&
    Array.isArray(x.failuresPerLook) && x.failuresPerLook.every((f) => typeof f === "number") &&
    typeof x.gate?.k === "number" && typeof x.gate.n === "number" &&
    typeof x.playerModel === "string" &&
    typeof x.judgeModel === "string" &&
    typeof x.report === "string" &&
    (x.noFalseAccepts === undefined || isNoFalseAccepts(x.noFalseAccepts))
  );
}

/**
 * Read the record, or start one when there is no file (`null`). A file that has
 * changed shape is refused: read as best it could be, it would call a checked
 * Seed Word unchecked, or the reverse.
 */
export function parseBatchRecord(text: string | null): BatchRecord {
  if (text === null) return { seeds: {} };
  const raw = JSON.parse(text) as { seeds?: unknown };
  if (typeof raw?.seeds !== "object" || raw.seeds === null) throw new Error("data/batches.json has no seeds");
  for (const [seed, entries] of Object.entries(raw.seeds)) {
    if (!Array.isArray(entries) || !entries.every(isEntry)) throw new Error(`data/batches.json: the entries for ${seed} do not read`);
  }
  return { seeds: raw.seeds as Record<string, BatchEntry[]> };
}

/** Every Batch a Seed Word has been through, oldest first. Empty for one never checked. */
export function batchesOf(record: BatchRecord, seedWord: string): BatchEntry[] {
  return record.seeds[seedWord] ?? [];
}

/** The record with these Batches added after any a Seed Word already has. */
export function recordBatches(record: BatchRecord, results: readonly { seedWord: string; entry: BatchEntry }[]): BatchRecord {
  const seeds: Record<string, BatchEntry[]> = {};
  for (const [seed, entries] of Object.entries(record.seeds)) seeds[seed] = [...entries];
  for (const { seedWord, entry } of results) (seeds[seedWord] ??= []).push(entry);
  return { seeds };
}

/** The record as the committed file: its Seed Words in alphabetical order, one line per Batch. */
export function serialiseBatchRecord(record: BatchRecord): string {
  const seeds = Object.keys(record.seeds).sort().map((s) =>
    `    ${JSON.stringify(s)}: [\n${record.seeds[s]!.map((e) => `      ${JSON.stringify(e)}`).join(",\n")}\n    ]`);
  return `{\n  "note": ${JSON.stringify(NOTE)},\n  "seeds": {${seeds.length ? `\n${seeds.join(",\n")}\n  ` : ""}}\n}\n`;
}
