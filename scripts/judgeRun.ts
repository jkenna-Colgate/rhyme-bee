/**
 * The Judge's leg of a run, shared by `judge` and `synthetic-player` (#250):
 * read what the index knows about each word, send the rhyme prompt, ask the
 * wordhood question of the rulings that would act, and classify where each would
 * land. It writes no game data; the caller writes the run report.
 */

import { readFileSync } from "node:fs";
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
  type JudgeQuestion,
  type RhymeRuling,
  type WordFacts,
  type WordhoodRuling,
} from "../src/judge.ts";
import type { RulesLexicon } from "../src/judgeRules.ts";
import { applyNormalisation } from "../src/normalise.ts";
import { rhymeKeyOf, type RhymeKey } from "../src/phonology.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import { callModel, inParallel, root } from "./modelCall.ts";

/** The pinned model the Judge was measured on. It moves only in the yearly sitting ADR-0021 describes. */
export const JUDGE_MODEL = "claude-sonnet-5-5";

export function loadIndex(): RhymeIndex {
  return loadRhymeIndex(indexArtifactPath(resolve(root, "dist-data")));
}

export function wordFacts(index: RhymeIndex, word: string): WordFacts {
  return {
    isWord: index.hasWord(word),
    readings: index.readingsOf(word).map((r) => r.pronunciation),
    unmergedReadings: index.unmergedReadingsOf(word),
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

/** The Seed Word's key on the Schedule, where it has a day. */
export function scheduledKey(seedWord: string): RhymeKey | undefined {
  const schedule = JSON.parse(readFileSync(resolve(root, "data/schedule.json"), "utf8")) as { days: { seed: string; rhymeKey: string }[] };
  return schedule.days.find((d) => d.seed === seedWord)?.rhymeKey;
}

export interface JudgeItem {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  question: JudgeQuestion;
}

export interface JudgedItem extends JudgeItem {
  ruling: RhymeRuling;
  wordhood?: WordhoodRuling;
  /** Absent for an item the Judge was not asked about. */
  classification?: Classification;
}

export interface JudgeLeg {
  items: JudgedItem[];
  calls: { rhyme: number; wordhood: number; fromCache: number };
  answeredBy: string[];
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
  opts: { model: string; run: number; askEvery?: boolean; askWordhood: boolean },
): Promise<JudgeLeg> {
  const calls = { rhyme: 0, wordhood: 0, fromCache: 0 };
  const answeredBy = new Set<string>();
  const sent = items.filter((i) => opts.askEvery || "ask" in i.question);
  const rulings = new Map<JudgeItem, RhymeRuling>();
  const batches = rhymeBatches(sent);
  await inParallel(batches.map((batch) => async () => {
    const reply = await callModel(opts.model, rhymePrompt(batch), opts.run);
    calls.rhyme++;
    if (reply.cached) calls.fromCache++;
    reply.answeredBy.forEach((m) => answeredBy.add(m));
    parseRhymeReply(reply.text, batch.length).forEach((r, i) => rulings.set(batch[i]!, r));
  }));

  const judged: JudgedItem[] = items.map((item) => {
    const ruling = rulings.get(item) ?? NOT_ASKED;
    return "ask" in item.question
      ? { ...item, ruling, classification: classifyRuling(item.question.ask, ruling, item.rhymeKey) }
      : { ...item, ruling };
  });

  if (opts.askWordhood) {
    const words = [...new Set(judged.filter((j) => j.classification?.needsWordhood).map((j) => j.word))].sort();
    const wordhood = new Map<string, WordhoodRuling>();
    const chunks = Array.from({ length: Math.ceil(words.length / WORDHOOD_BATCH) }, (_, i) => words.slice(i * WORDHOOD_BATCH, (i + 1) * WORDHOOD_BATCH));
    await inParallel(chunks.map((chunk) => async () => {
      const reply = await callModel(opts.model, wordhoodPrompt(chunk), opts.run);
      calls.wordhood++;
      if (reply.cached) calls.fromCache++;
      reply.answeredBy.forEach((m) => answeredBy.add(m));
      for (const r of parseWordhoodReply(reply.text, chunk)) wordhood.set(r.word, r);
    }));
    for (const j of judged) {
      const w = wordhood.get(j.word);
      if (j.classification?.needsWordhood && w && "ask" in j.question) {
        j.wordhood = w;
        j.classification = classifyRuling(j.question.ask, j.ruling, j.rhymeKey, w);
      }
    }
  }
  process.stderr.write("\n");
  return { items: judged, calls, answeredBy: [...answeredBy].sort() };
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
