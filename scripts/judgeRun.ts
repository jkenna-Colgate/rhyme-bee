/**
 * The Judge's leg of a run, shared by `judge` and `synthetic-player` (#250):
 * read what the index knows about each word, send the rhyme prompt, ask the
 * wordhood question of the rulings that would act, and classify where each would
 * land. `landJudgeLeg` writes what the rulings earn (#266); the caller writes the
 * run report. The No False Accepts hunt asks the same two questions through
 * `askBoth` (#268), and so every call to the Judge is made and counted here.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRhymeIndex } from "../src/loader.ts";
import {
  classifyRuling,
  judgeQuestion,
  parseRhymeReply,
  parseWordhoodReply,
  rhymeBatches,
  rhymePrompt,
  WORDHOOD_BATCH,
  wordhoodPrompt,
  type Classification,
  type JudgedPair,
  type JudgeQuestion,
  type RhymeRuling,
  type WordFacts,
  type WordhoodRuling,
} from "../src/judge.ts";
import { land, parseRulingRecords, serialiseRulingRecord, supplementAppend, type JudgeRulingRecord, type Landings } from "../src/judgeLanding.ts";
import type { RulesLexicon } from "../src/judgeRules.ts";
import { applyNormalisation } from "../src/normalise.ts";
import { rhymeKeyOf, type RhymeKey } from "../src/phonology.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { parseSchedule, type Schedule } from "../src/schedule.ts";
import type { ScoringConfig } from "../src/session.ts";
import { serialiseUnconfirmedRhyme } from "../src/unconfirmedRhymes.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import { callModel, inParallel, root } from "./modelCall.ts";

/** The pinned model the Judge was measured on. It moves only in the yearly sitting ADR-0021 describes. */
export const JUDGE_MODEL = "claude-sonnet-5-5";

/** The Synthetic Player's model is a setting, and starts at Sonnet (#227). */
export const DEFAULT_PLAYER_MODEL = "claude-sonnet-5-5";

export function loadIndex(): RhymeIndex {
  return loadRhymeIndex(indexArtifactPath(resolve(root, "dist-data")));
}

export function wordFacts(index: RhymeIndex, word: string): WordFacts {
  return {
    isWord: index.hasWord(word),
    readings: index.readingsOf(word).map((r) => r.pronunciation),
  };
}

export function rulesLexicon(index: RhymeIndex): RulesLexicon {
  return {
    readingsOf: (w) => index.readingsOf(w).map((r) => r.pronunciation),
    unmergedReadingsOf: (w) => index.unmergedReadingsOf(w),
    isWord: (w) => index.hasWord(w),
    known: (w) => index.tierOf(w).tier === "answer",
  };
}

/**
 * A Seed Word's Rhyme Key as the index reads it now: the key its pinned reading
 * has after today's Normalisation, which may differ from the key it had when a
 * pair was cut (`utility` was `IH L AH T IY` and is `IH L AH D IY`).
 */
export function seedKeyNow(index: RhymeIndex, seedWord: string, seedReading: string | null, keyWhenCut?: RhymeKey): RhymeKey {
  const keys = index.rhymeKeysOf(seedWord);
  if (seedReading) {
    const pronunciations = new Map([["", [seedReading.split(" ")]]]);
    applyNormalisation({ pronunciations });
    const now = pronunciations.get("")!.map(rhymeKeyOf);
    const hit = keys.find((k) => now.includes(k));
    if (hit) return hit;
  }
  if (keyWhenCut && keys.includes(keyWhenCut)) return keyWhenCut;
  if (keys.length === 1) return keys[0]!;
  throw new Error(`cannot tell which Rhyme Key ${seedWord} is pinned to now (it has ${keys.join(", ") || "none"})`);
}

const SCHEDULE = resolve(root, "data/schedule.json");

/** `data/schedule.json` as written, which a rewrite carries through, and as a Schedule. */
export interface ScheduleFile {
  raw: Record<string, unknown> & { scoring: ScoringConfig };
  schedule: Schedule;
}

/** Read `data/schedule.json`, refusing a file that does not read as a Schedule. */
export function readScheduleFile(): ScheduleFile {
  const raw = JSON.parse(readFileSync(SCHEDULE, "utf8")) as ScheduleFile["raw"];
  const schedule = parseSchedule(raw);
  if (schedule === null) throw new Error(`${SCHEDULE} does not read as a Schedule`);
  return { raw, schedule };
}

/** Write `data/schedule.json` with `changes` over the fields it was read with. Returns the path. */
export function writeScheduleFile(raw: ScheduleFile["raw"], changes: Partial<Schedule>): string {
  writeFileSync(SCHEDULE, `${JSON.stringify({ ...raw, ...changes }, null, 2)}\n`);
  return SCHEDULE;
}

function scheduledDays(): { seed: string; rhymeKey: string }[] {
  return readScheduleFile().schedule.days;
}

/** The Seed Word's key on the Schedule, where it has a day. */
export function scheduledKey(seedWord: string): RhymeKey | undefined {
  return scheduledDays().find((d) => d.seed === seedWord)?.rhymeKey;
}

const RULINGS = resolve(root, "data/judge-rulings.jsonl");
const SUPPLEMENT = resolve(root, "data/supplement.dict");
const UNCONFIRMED = resolve(root, "data/unconfirmed-rhymes.txt");

/** Every Candidate the Judge has ruled on, from `data/judge-rulings.jsonl`. A line that does not read is named and dropped. */
export function readRulings(): JudgeRulingRecord[] {
  if (!existsSync(RULINGS)) return [];
  const { records, malformed } = parseRulingRecords(readFileSync(RULINGS, "utf8"));
  for (const line of malformed) console.error(`judge-rulings.jsonl: dropped a line that does not read: ${line}`);
  return records;
}

/**
 * Land a leg's rulings (#266): what each earns, written to the game's data,
 * and every ruling recorded so it is never sent again. The record is written
 * last, so a run that stops part way sends again what it had not yet recorded.
 * The index is not rebuilt here.
 */
export function landJudgeLeg(leg: JudgeLeg, opts: { model: string; date: string }): Landings {
  const landings = land(leg.items, { ...opts, scheduledSeeds: new Set(scheduledDays().map((d) => d.seed)) });
  const supplement = supplementAppend(readFileSync(SUPPLEMENT, "utf8"), landings.readings);
  if (supplement) appendFileSync(SUPPLEMENT, supplement);
  appendLines(UNCONFIRMED, landings.unconfirmedRhymes.map(serialiseUnconfirmedRhyme));
  appendLines(RULINGS, landings.records.map(serialiseRulingRecord));
  return landings;
}

/** What a leg's landings wrote, as every run report lists it under `writes`. */
export interface LandedWrites {
  readings: { word: string; reading: string }[];
  unconfirmedRhymes: Landings["unconfirmedRhymes"];
  suggestedDemotions: { word: string; rhymeKey: string; reason: string }[];
}

export const noWrites = (): LandedWrites => ({ readings: [], unconfirmedRhymes: [], suggestedDemotions: [] });

/** Add what one leg's landings wrote to a run's `writes`. */
export function addWrites(into: LandedWrites, landings: Landings): LandedWrites {
  into.readings.push(...landings.readings.map((r) => ({ word: r.word, reading: r.phonemes.join(" ") })));
  into.unconfirmedRhymes.push(...landings.unconfirmedRhymes);
  into.suggestedDemotions.push(
    ...landings.records
      .filter((r) => r.landed === "suggested-demotion")
      .map((r) => ({ word: r.word, rhymeKey: r.rhymeKey, reason: r.wordhood!.verdict })),
  );
  return into;
}

/** A Candidate's word, the Seed Word it was entered for and that word's Rhyme Key: what names one in a report. */
export interface CandidatePair {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
}

export const candidatePair = ({ word, seedWord, rhymeKey }: CandidatePair): CandidatePair => ({ word, seedWord, rhymeKey });

/** A Candidate as one line names it: `snored for bored /AO R D/`. */
export const pairLine = (p: CandidatePair): string => `${p.word} for ${p.seedWord} /${p.rhymeKey}/`;

/** Append whole lines, starting a fresh line if the file's last one was left open. */
function appendLines(path: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  const open = existsSync(path) && !/(^|\n)$/.test(readFileSync(path, "utf8"));
  appendFileSync(path, `${open ? "\n" : ""}${lines.join("")}`);
}

export interface JudgeItem extends CandidatePair {
  question: JudgeQuestion;
}

export interface JudgedItem extends JudgeItem {
  ruling: RhymeRuling;
  wordhood?: WordhoodRuling;
  /** Absent for an item the Judge was not asked about. */
  classification?: Classification;
}

/** The calls a run made to the model, by question, and how many the cache answered. */
export interface JudgeCalls {
  rhyme: number;
  wordhood: number;
  fromCache: number;
}

export const noCalls = (): JudgeCalls => ({ rhyme: 0, wordhood: 0, fromCache: 0 });

/** Add one leg's calls into a run's total. */
export function addCalls(into: JudgeCalls, more: JudgeCalls): void {
  into.rhyme += more.rhyme;
  into.wordhood += more.wordhood;
  into.fromCache += more.fromCache;
}

export interface JudgeLeg {
  items: JudgedItem[];
  calls: JudgeCalls;
  answeredBy: string[];
}

/** What a leg's calls are counted into as they are made. */
interface Tally {
  calls: JudgeCalls;
  answeredBy: Set<string>;
}

interface CallOptions {
  model: string;
  run: number;
  label?: string;
}

async function ask(prompt: string, kind: "rhyme" | "wordhood", opts: CallOptions, tally: Tally): Promise<string> {
  const reply = await callModel(opts.model, prompt, opts.run, opts.label);
  tally.calls[kind]++;
  if (reply.cached) tally.calls.fromCache++;
  reply.answeredBy.forEach((m) => tally.answeredBy.add(m));
  return reply.text;
}

/** The rhyme prompt, as it was measured, over `pairs` in batches. A pair whose reply did not read is absent. */
async function askRhyme<T extends JudgedPair & { rhymeKey: RhymeKey }>(
  pairs: readonly T[],
  opts: CallOptions,
  tally: Tally,
): Promise<Map<T, RhymeRuling>> {
  const rulings = new Map<T, RhymeRuling>();
  await inParallel(rhymeBatches(pairs).map((batch) => async () => {
    const text = await ask(rhymePrompt(batch), "rhyme", opts, tally);
    parseRhymeReply(text, batch.length).forEach((r, i) => rulings.set(batch[i]!, r));
  }));
  return rulings;
}

/** The wordhood question, apart from the rhyme one, of each word once, `WORDHOOD_BATCH` words a call. */
async function askWordhood(words: readonly string[], opts: CallOptions, tally: Tally): Promise<Map<string, WordhoodRuling>> {
  const sorted = [...new Set(words)].sort();
  const wordhood = new Map<string, WordhoodRuling>();
  const chunks = Array.from({ length: Math.ceil(sorted.length / WORDHOOD_BATCH) }, (_, i) => sorted.slice(i * WORDHOOD_BATCH, (i + 1) * WORDHOOD_BATCH));
  await inParallel(chunks.map((chunk) => async () => {
    const text = await ask(wordhoodPrompt(chunk), "wordhood", opts, tally);
    for (const r of parseWordhoodReply(text, chunk)) wordhood.set(r.word, r);
  }));
  return wordhood;
}

/**
 * Both of the Judge's questions, of every pair and every word, with no ruling
 * classified: what the No False Accepts hunt asks of a scored Answer (#268),
 * where nothing the Judge rules lands by itself.
 */
export async function askBoth<T extends JudgedPair & { rhymeKey: RhymeKey }>(
  pairs: readonly T[],
  opts: CallOptions,
): Promise<{ rhyme: Map<T, RhymeRuling>; wordhood: Map<string, WordhoodRuling>; calls: JudgeCalls; answeredBy: string[] }> {
  const tally: Tally = { calls: noCalls(), answeredBy: new Set() };
  const rhyme = await askRhyme(pairs, opts, tally);
  const wordhood = await askWordhood(pairs.map((p) => p.word), opts, tally);
  process.stderr.write("\n");
  return { rhyme, wordhood, calls: tally.calls, answeredBy: [...tally.answeredBy].sort() };
}

const NOT_ASKED: RhymeRuling = { verdict: "no-ruling", reading: null, confidence: "low", why: "not sent to the Judge" };

/** How many calls the Judge's rhyme leg takes for these items, before any is made. */
export function rhymeCalls(items: readonly JudgeItem[]): number {
  return rhymeBatches(items.filter((i) => "ask" in i.question)).length;
}

/**
 * Rule on every item the Judge is asked about. With `askEvery`, an item the
 * Judge would not be sent is ruled on too, as `--score` needs: a label set
 * scores the Judge on every pair, whatever the game knows about it now. The
 * wordhood question is asked only of rulings that would act.
 */
export async function runJudge(
  items: readonly JudgeItem[],
  opts: CallOptions & { askEvery?: boolean; askWordhood: boolean },
): Promise<JudgeLeg> {
  const tally: Tally = { calls: noCalls(), answeredBy: new Set() };
  const rulings = await askRhyme(items.filter((i) => opts.askEvery || "ask" in i.question), opts, tally);

  const judged: JudgedItem[] = items.map((item) => {
    const ruling = rulings.get(item) ?? NOT_ASKED;
    return "ask" in item.question
      ? { ...item, ruling, classification: classifyRuling(item.question.ask, ruling, item.rhymeKey) }
      : { ...item, ruling };
  });

  if (opts.askWordhood) {
    const wordhood = await askWordhood(judged.filter((j) => j.classification?.needsWordhood).map((j) => j.word), opts, tally);
    for (const j of judged) {
      const w = wordhood.get(j.word);
      if (j.classification?.needsWordhood && w && "ask" in j.question) {
        j.wordhood = w;
        j.classification = classifyRuling(j.question.ask, j.ruling, j.rhymeKey, w);
      }
    }
  }
  process.stderr.write("\n");
  return { items: judged, calls: tally.calls, answeredBy: [...tally.answeredBy].sort() };
}

/** One ruling as a run report lists it. */
export function reportRuling(j: JudgedItem) {
  return {
    word: j.word,
    seedWord: j.seedWord,
    rhymeKey: j.rhymeKey,
    ...("ask" in j.question ? { knew: j.question.ask } : { setAside: j.question.setAside }),
    verdict: j.ruling.verdict,
    reading: j.ruling.reading,
    confidence: j.ruling.confidence,
    why: j.ruling.why,
    ...(j.classification ? { reachesKey: j.classification.reachesKey, wouldLand: j.classification.lands } : {}),
    ...(j.classification?.needsWordhood ? { wordhood: "not asked" } : {}),
    ...(j.wordhood ? { wordhood: j.wordhood.verdict, wordhoodConfidence: j.wordhood.confidence, wordhoodWhy: j.wordhood.why } : {}),
  };
}

/** How many rulings would land where. */
export function landingCounts(items: readonly JudgedItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of items) if (j.classification) out[j.classification.lands] = (out[j.classification.lands] ?? 0) + 1;
  return out;
}
