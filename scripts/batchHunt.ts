/**
 * The No False Accepts half of a Batch, from the command line (#268): the hunt,
 * the Judge's two questions, and the ruling list the maintainer settles in the
 * sitting. The rules are `src/noFalseAccepts.ts`; this file reads the extract,
 * calls the model, asks the maintainer and writes what they decide.
 *
 * Every write goes through a path the Editor's Pass already uses: a correction
 * through `applyCorrection` (`data/supplement.dict`, replacing the readings the
 * game holds), a Demotion through `appendDemotion` (`data/demotions.txt`). There
 * is no third.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { rhymeBatches, WORDHOOD_BATCH, type RhymeRuling } from "../src/judge.ts";
import {
  huntAnswers,
  noFalseAcceptsResult,
  parseDecision,
  rulingPrompt,
  type Decision,
  type HuntedAnswer,
  type HuntRuling,
  type ListedAnswer,
  type NoFalseAcceptsResult,
} from "../src/noFalseAccepts.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { Schedule } from "../src/schedule.ts";
import { seedWordCheckLines } from "../src/seedWord.ts";
import { startSession, type PuzzleContext, type ScoringConfig } from "../src/session.ts";
import { ipaReadings, parseWiktionaryExtract, wiktionaryReadings, type WiktionaryExtract } from "../src/wiktionary.ts";
import { appendDemotion } from "../web/demotionFile.ts";
import { pinnedEvidenceContext } from "./editorAdd.ts";
import { applyCorrection } from "./editorCorrection.ts";
import { askBoth, type JudgeCalls } from "./judgeRun.ts";
import { root } from "./modelCall.ts";
import { checkLocalSources, WIKTIONARY_SOURCE } from "./sourceMirror.ts";

const dataDir = resolve(root, "data");

/**
 * The pinned extract, or why there is none: missing, or not the one
 * `data/sources.sha256` pins. A Batch stops on the reason before it calls
 * anything. CI never fetches the extract, so a clone that has only run
 * `npm run sources:fetch` lacks it until it is asked for by name.
 */
export function loadWiktionary(): WiktionaryExtract | { refused: string } {
  const faults = checkLocalSources(dataDir, [WIKTIONARY_SOURCE]);
  const problem = faults[0]?.problem;
  if (problem) {
    const why = { missing: "is missing", mismatch: "does not match its committed checksum", unpinned: "has no line in data/sources.sha256" }[problem];
    const fix = problem === "unpinned"
      ? `Build it with scripts/extract-wiktionary.ts and pin it:\n  npm run sources:upload -- ${WIKTIONARY_SOURCE}`
      : `Bring the pinned one from the mirror (the plain fetch leaves it out):\n  npm run sources:fetch -- ${WIKTIONARY_SOURCE}`;
    return { refused: `data/${WIKTIONARY_SOURCE} ${why}, so the No False Accepts hunt has no Wiktionary readings to compare. Nothing was called.\n${fix}` };
  }
  return parseWiktionaryExtract(readFileSync(resolve(dataDir, WIKTIONARY_SOURCE), "utf8"));
}

/** The Session a Seed Word starts on its Rhyme Key, or what the index said when it would not pin. */
export function sessionOn(index: RhymeIndex, seedWord: string, rhymeKey: RhymeKey, scoring: ScoringConfig): PuzzleContext | { failed: string } {
  try {
    return startSession(index, index.pinSeed(seedWord, rhymeKey), scoring);
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

/** One Seed Word's hunt: its scored Answers and the ones sent to the Judge. */
export interface HuntDay {
  seedWord: string;
  rhymeKey: RhymeKey;
  date: string | null;
  answers: number;
  hunted: HuntedAnswer[];
}

/** The hunt over the Seed Words that pin, on the index as it stands. Calls nothing. */
export function planHunt(
  index: RhymeIndex,
  seeds: readonly { seedWord: string; rhymeKey: RhymeKey; date: string | null }[],
  scoring: ScoringConfig,
  extract: WiktionaryExtract,
): HuntDay[] {
  const facts = { wiktionaryReadings: (w: string) => wiktionaryReadings(extract, w), isName: (w: string) => index.isName(w) };
  return seeds.flatMap((s) => {
    const session = sessionOn(index, s.seedWord, s.rhymeKey, scoring);
    if ("failed" in session) return [];
    const answers = [...session.answerScores.keys()];
    return [{ ...s, answers: answers.length, hunted: huntAnswers(answers, s.rhymeKey, facts) }];
  });
}

/** The calls the Judge's two questions take for a hunt, before any is made. */
export function huntCalls(days: readonly HuntDay[]): { sent: number; rhyme: number; wordhood: number } {
  const pairs = days.flatMap((d) => d.hunted.map((h) => ({ word: h.word, seedWord: d.seedWord, rhymeKey: d.rhymeKey })));
  const words = new Set(pairs.map((p) => p.word)).size;
  return { sent: pairs.length, rhyme: rhymeBatches(pairs).length, wordhood: Math.ceil(words / WORDHOOD_BATCH) };
}

export interface HuntLeg {
  rulings: HuntRuling[];
  calls: JudgeCalls;
  answeredBy: string[];
}

const NO_RULING: RhymeRuling = { verdict: "no-ruling", reading: null, confidence: "low", why: "no reply" };

/** Ask the Judge both questions of every hunted Answer: the rhyme prompt as it was measured, and wordhood apart from it. */
export async function judgeHunt(days: readonly HuntDay[], opts: { model: string; run: number }): Promise<HuntLeg> {
  const pairs = days.flatMap((d) => d.hunted.map((answer) => ({ word: answer.word, seedWord: d.seedWord, rhymeKey: d.rhymeKey, answer })));
  const { rhyme, wordhood, calls, answeredBy } = await askBoth(pairs, { ...opts, label: "hunt" });
  const rulings: HuntRuling[] = pairs.map((p) => {
    const w = wordhood.get(p.word);
    return { seedWord: p.seedWord, rhymeKey: p.rhymeKey, answer: p.answer, rhyme: rhyme.get(p) ?? NO_RULING, ...(w ? { wordhood: w } : {}) };
  });
  return { rulings, calls, answeredBy };
}

/** What the maintainer decided on one listed Answer, and what was written for it. */
export interface Settled {
  listed: ListedAnswer;
  decision: Decision;
  wrote: string | null;
}

/** The readings a correction may be picked from: Wiktionary's, as ARPAbet before Normalisation, which the build applies. */
function offeredReadings(extract: WiktionaryExtract, word: string): Pronunciation[] {
  const seen = new Set<string>();
  return (extract.get(word) ?? []).flatMap(ipaReadings).filter((r) => !seen.has(r.join(" ")) && !!seen.add(r.join(" ")));
}

/** Rebuild the Rhyme Index, as a Batch does after each look that lands a write. */
export function rebuild(): { ok: true } | { ok: false; error: string } {
  const built = spawnSync("npx", ["tsx", "scripts/build-index.ts"], { cwd: root, shell: true, encoding: "utf8" });
  return built.status === 0 ? { ok: true } : { ok: false, error: built.stderr };
}

/**
 * Put the ruling list to the maintainer, one Answer at a time, and write each
 * ruling as it is made. With no terminal to ask, the list is printed and every
 * Answer on it is left unruled, which fails the day's gate.
 */
export async function settleRulingList(
  list: readonly ListedAnswer[],
  ctx: { index: () => RhymeIndex; extract: WiktionaryExtract; schedule: Schedule; today: string; loadIndex: () => RhymeIndex },
): Promise<Settled[]> {
  const settled: Settled[] = [];
  const asking = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stderr }) : null;
  if (list.length) console.error(`\nThe ruling list: ${list.length} scored Answers the Judge doubts at high confidence. Each stays scored until you rule.`);
  if (!asking && list.length) console.error("No terminal to ask on, so every one is left unruled.");
  try {
    for (const [i, item] of list.entries()) {
      const index = ctx.index();
      const word = item.answer.word;
      const offered = offeredReadings(ctx.extract, word);
      console.error(`\n[${i + 1}/${list.length}] ${word} for ${item.seedWord} /${item.rhymeKey}/: ${item.doubts.join(", ")}`);
      console.error(`  Judge, rhyme: ${item.rhyme.verdict} (${item.rhyme.confidence}) ${item.rhyme.why}`);
      if (item.wordhood) console.error(`  Judge, wordhood: ${item.wordhood.verdict} (${item.wordhood.confidence}) ${item.wordhood.why}`);
      console.error(`  sent for: ${item.answer.reasons.join(", ")}`);
      for (const r of index.readingsOf(word)) console.error(`  the game reads: ${r.pronunciation.join(" ")}`);
      for (const ipa of ctx.extract.get(word) ?? []) console.error(`  Wiktionary: ${ipa}`);
      for (const line of rulingPrompt(offered)) console.error(`  ${line}`);
      let decision: Decision = { kind: "unruled" };
      while (asking) {
        const got = parseDecision(await asking.question("  your ruling > "), offered);
        if (got) { decision = got; break; }
        console.error(`  That does not read. Type ${offered.length ? "c <n>, " : ""}c <ARPAbet>, d, d word, l or s, then Enter.`);
      }
      let wrote: string | null = null;
      if (decision.kind === "correction") {
        const result = await applyCorrection(
          { word, target: item.rhymeKey, phonemes: decision.reading, mode: "replace" },
          {
            context: pinnedEvidenceContext, schedule: () => ctx.schedule, today: () => ctx.today,
            openIndex: ctx.loadIndex, rebuild: async () => rebuild(), source: "batch",
          },
        );
        wrote = `data/supplement.dict: ${word} ${decision.reading.join(" ")}${result.rebuilt.ok ? "" : " (the rebuild failed)"}`;
        // A reading given to a scheduled Seed Word runs the Seed Word test (#264), as it does in the Editor's Pass.
        for (const line of seedWordCheckLines(result.seedWords)) console.error(`  ${line}`);
      } else if (decision.kind === "demotion") {
        appendDemotion(resolve(dataDir, "demotions.txt"), { word, reason: decision.reason });
        wrote = `data/demotions.txt: ${word} ${decision.reason}`;
      }
      if (wrote) console.error(`  wrote ${wrote}`);
      settled.push({ listed: item, decision, wrote });
    }
  } finally {
    asking?.close();
  }
  return settled;
}

/** The gate on each Seed Word, read off the index rebuilt with the rulings. */
export function huntResults(
  days: readonly HuntDay[],
  settled: readonly Settled[],
  index: RhymeIndex,
  scoring: ScoringConfig,
): Map<string, NoFalseAcceptsResult> {
  const out = new Map<string, NoFalseAcceptsResult>();
  for (const d of days) {
    const mine = settled.filter((s) => s.listed.seedWord === d.seedWord);
    const session = sessionOn(index, d.seedWord, d.rhymeKey, scoring);
    const scored: ReadonlySet<string> = new Set("failed" in session ? [] : session.answerScores.keys());
    out.set(d.seedWord, noFalseAcceptsResult(
      mine.map((s) => s.listed.answer.word),
      new Map(mine.map((s) => [s.listed.answer.word, s.decision])),
      (w) => scored.has(w),
    ));
  }
  return out;
}
