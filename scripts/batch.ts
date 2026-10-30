/**
 * A Batch, from the command line (#267, ADR-0021): the maintainer's sitting that
 * checks a block of Seed Words for Trust before their dates. It is run by a
 * person and never by a scheduled job.
 *
 *   npx tsx scripts/batch.ts --from <date> --to <date> [settings] [--yes]
 *   npx tsx scripts/batch.ts --seeds <word>[=<Rhyme Key>] ... [settings] [--yes]
 *
 *   settings: [--model <id>] [--k N] [--n N] [--off-key-ratio R] [--max-judge-calls N]
 *
 * The Seed Words are those the Schedule plays from `--from` to `--to`, in date
 * order with the ones already played last (`batchBlock`), or those named after
 * `--seeds`, which need hold no place: that is how a word gets the Batch that
 * growing the Schedule asks of it (#271). A named word is played on the Rhyme
 * Key given after `=` (`--seeds "tear=IH R"`), or else on its only key, or the
 * one whose family holds the most Answers (`namedBlock`). About 30 make a
 * sitting. Without `--yes` the command states the calls it will make on each
 * model, which is the run's cost, and stops there: every call is on the
 * maintainer's subscription. A run on an Opus model is refused without it.
 *
 * Each **look** is one Synthetic Player run per Seed Word, on `--model` (an
 * exact id, Sonnet by default), shown the respelling and one example rhyme. A
 * run whose words fall more than `--off-key-ratio` to one on another Rhyme Key
 * misheard the word and is played again once; a second off-key run makes the
 * day untested, and the Batch moves on. Every Candidate is ruled by the Judge on
 * its pinned model, once (a Candidate ruled before is not sent again), and what
 * each ruling earns lands as `judge` lands it (#266). The index is rebuilt with
 * what landed before the next look. A day passes on the first look after the
 * first that finds at most `--k` Trust failures, and fails if `--n` looks go by
 * without one. A day that fails ships anyway.
 *
 * Then the **No False Accepts** half (#268, `scripts/batchHunt.ts`): every scored
 * Answer whose Wiktionary readings (`data/wiktionary.tsv`, fetched by name with
 * `npm run sources:fetch -- wiktionary.tsv`, and checked before anything is
 * called) all miss the Seed Word's Rhyme Key, or that the names data holds, is
 * put to the Judge, rhyme and wordhood apart. Nothing it rules lands by itself:
 * a high-confidence ruling that an Answer is no Rhyme, a name or not a word goes
 * on a ruling list, and the maintainer rules on each in the sitting (a
 * correction, a Demotion, or leave it). The gate passes a day when no listed
 * Answer is left unruled and none corrected or demoted is still scored.
 *
 * It writes the run report to `data/judge-runs/` and the result per Seed Word
 * to `data/batches.json`, both to be committed with what landed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  batchBlock,
  batchCost,
  DEFAULT_OFF_KEY_RATIO,
  DEFAULT_TRUST_GATE,
  keyCount,
  lookAttempt,
  namedBlock,
  parseBatchRecord,
  recordBatches,
  serialiseBatchRecord,
  trustFailures,
  trustVerdict,
  type BatchEntry,
  type BatchSeed,
  type KeyCount,
  type LookCandidate,
  type TrustGate,
  type TrustResult,
} from "../src/batch.ts";
import { parseDeclines } from "../src/declines.ts";
import { judgeQuestion, readingReachesKey } from "../src/judge.ts";
import { planJudging, rulingKey, type JudgeRulingRecord } from "../src/judgeLanding.ts";
import type { PuzzleContext } from "../src/session.ts";
import { exampleRhyme, parsePlayerReply, playerPrompt, playWords, type SyntheticPlay } from "../src/syntheticPlayer.ts";
import {
  addCalls,
  addWrites,
  DEFAULT_PLAYER_MODEL,
  JUDGE_MODEL,
  landJudgeLeg,
  loadIndex,
  noWrites,
  readRulings,
  readScheduleFile,
  reportRuling,
  rhymeCalls,
  runJudge,
  wordFacts,
  type JudgedItem,
  type JudgeItem,
} from "./judgeRun.ts";
import { rulingList, type NoFalseAcceptsResult } from "../src/noFalseAccepts.ts";
import {
  huntCalls,
  huntResults,
  judgeHunt,
  loadWiktionary,
  planHunt,
  rebuild,
  sessionOn,
  settleRulingList,
  type HuntDay,
  type HuntLeg,
  type Settled,
} from "./batchHunt.ts";
import { callModel, exactModelId, inParallel, nextRun, root, today, writeRunReport, type ModelReply } from "./modelCall.ts";

// ---- the settings --------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const number = (name: string, fallback: number) => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} ${raw} is not a number`);
  return n;
};
const from = flag("from");
const to = flag("to");
const seedsAt = argv.indexOf("--seeds");
const named: string[] = [];
if (seedsAt >= 0) {
  for (const a of argv.slice(seedsAt + 1)) {
    if (a.startsWith("--")) break;
    named.push(a);
  }
}
const byRange = from !== undefined || to !== undefined;
if (byRange ? !from || !to || seedsAt >= 0 : named.length === 0) {
  console.error(
    "usage: batch --from <date> --to <date> [settings] [--yes]\n" +
    "       batch --seeds <word>[=<Rhyme Key>] ... [settings] [--yes]\n" +
    "settings: [--model <id>] [--k N] [--n N] [--off-key-ratio R] [--max-judge-calls N]",
  );
  process.exit(2);
}
const playerModel = exactModelId(flag("model") ?? DEFAULT_PLAYER_MODEL);
const gate: TrustGate = { k: number("k", DEFAULT_TRUST_GATE.k), n: number("n", DEFAULT_TRUST_GATE.n) };
const offKeyRatio = number("off-key-ratio", DEFAULT_OFF_KEY_RATIO);
const maxJudgeCalls = number("max-judge-calls", 30);
const confirmed = argv.includes("--yes");
trustVerdict([0], gate); // refuses an n that leaves no look after a fix, before anything is called

const BATCHES = resolve(root, "data/batches.json");
const DECLINES = resolve(root, "data/declines.txt");

const date = today();
const { raw: scheduleRaw, schedule } = readScheduleFile();
let index = loadIndex();
let block: BatchSeed[];
try {
  block = from && to ? batchBlock(schedule, from, to, date) : namedBlock(named, index);
} catch (e) {
  console.error(`Batch refused, and nothing was called: ${(e as Error).message}`);
  process.exit(1);
}
const what = from && to ? `${from} to ${to}` : `of ${block.length} named Seed Word(s)`;
const loaded = loadWiktionary();
if ("refused" in loaded) {
  console.error(`Batch ${what}: ${loaded.refused}`);
  process.exit(1);
}
const wiktionary = loaded;
const huntPlan = huntCalls(planHunt(index, block, scheduleRaw.scoring, wiktionary));

// ---- the plan ------------------------------------------------------------------

console.error(`Batch ${what}: ${block.length} Seed Words, ${block.filter((s) => s.played).length} already played and put last`);
for (const s of block) console.error(`  ${s.date ?? "(no place)"} ${s.seedWord} /${s.rhymeKey}/${s.played ? " (played)" : ""}`);
console.error(
  `Calls, all on the maintainer's subscription:\n` +
  `  Synthetic Player (${playerModel}): ${block.length * 2} to ${block.length * gate.n} looks (${gate.n} at most each), plus one re-run per off-key look\n` +
  `  Judge (${JUDGE_MODEL}): one rhyme call per 8 new Candidates and one wordhood call per 20 that would act, on every look;\n` +
  `    about 1 to 3 a look for 3 Seed Words, and at most ${maxJudgeCalls} rhyme calls a look (--max-judge-calls)\n` +
  `  Trust gate: k = ${gate.k} within n = ${gate.n} looks; off key above ${offKeyRatio} to 1\n` +
  `  No False Accepts hunt, Judge (${JUDGE_MODEL}): ${huntPlan.sent} scored Answers sent on today's index, ` +
  `${huntPlan.rhyme} rhyme calls and ${huntPlan.wordhood} wordhood calls (recounted after the looks land)`,
);
const cost = batchCost({ seeds: block.length, gate, maxJudgeCalls, hunt: huntPlan }, { player: playerModel, judge: JUDGE_MODEL });
console.error("The cost, in calls:");
for (const c of cost) console.error(`  ${c.fewest} to ${c.most} calls on ${c.model}${c.opus ? " (an Opus model)" : ""}`);
if (block.length > 30) console.error(`  ${block.length} Seed Words is more than a sitting of about 30.`);
if (!confirmed) {
  const opus = cost.filter((c) => c.opus);
  if (opus.length > 0) {
    console.error(
      `Refusing: ${opus.map((c) => `${c.fewest} to ${c.most} calls on ${c.model}`).join(" and ")} is an Opus run, ` +
      "which needs the maintainer's yes to that cost (#267). Nothing was called. Run again with --yes once they have agreed.",
    );
    process.exit(1);
  }
  console.error("Nothing was called. Run again with --yes once the maintainer has agreed to the calls.");
  process.exit(0);
}

// ---- the sitting ---------------------------------------------------------------

const stem = from && to ? `batch.${from}..${to}.${playerModel}` : `batch.seeds.${block.map((s) => s.seedWord).join("-").slice(0, 60)}.${playerModel}`;
const run = nextRun(stem);

interface RunOfLook {
  attempt: number;
  words: string[];
  keyCount: KeyCount;
  answeredBy: string[];
}
interface Look {
  look: number;
  runs: RunOfLook[];
  example: string | null;
  play?: SyntheticPlay;
  trustFailures?: string[];
}
interface Day {
  seed: BatchSeed;
  rhymeKey: string;
  looks: Look[];
  failuresPerLook: number[];
  result?: TrustResult;
  /** Why the Batch has no result for the day: it did not pin, or the Batch stopped. */
  notChecked?: string;
}

const days: Day[] = block.map((seed) => ({ seed, rhymeKey: seed.rhymeKey, looks: [], failuresPerLook: [] }));
const calls = { player: 0, rhyme: 0, wordhood: 0, fromCache: 0 };
const answeredBy = new Set<string>();
const allRulings: (ReturnType<typeof reportRuling> & { look: number; landed: string | null })[] = [];
const writes = noWrites();
const note = (r: ModelReply) => {
  calls.player++;
  if (r.cached) calls.fromCache++;
  r.answeredBy.forEach((m) => answeredBy.add(m));
};
/** Count a Judge leg's calls and answering models into the run's. */
const noteLeg = (leg: { calls: Parameters<typeof addCalls>[1]; answeredBy: string[] }) => {
  addCalls(calls, leg.calls);
  leg.answeredBy.forEach((m) => answeredBy.add(m));
};

function contextOf(day: Day): PuzzleContext | null {
  const ctx = sessionOn(index, day.seed.seedWord, day.seed.rhymeKey, scheduleRaw.scoring);
  if ("failed" in ctx) {
    day.notChecked = `does not pin to its Rhyme Key: ${ctx.failed}`;
    return null;
  }
  day.rhymeKey = ctx.seed.rhymeKey;
  return ctx;
}

let stopped: string | null = null;
for (let lookNo = 1; lookNo <= gate.n && !stopped; lookNo++) {
  const active = days.filter((d) => !d.result && !d.notChecked);
  if (active.length === 0) break;
  console.error(`\nlook ${lookNo}: ${active.length} Seed Words`);

  // Play, and play an off-key run once more.
  const contexts = new Map<Day, PuzzleContext>();
  for (const d of active) {
    const ctx = contextOf(d);
    if (ctx) contexts.set(d, ctx);
  }
  const playing = [...contexts.keys()];
  for (const d of playing) d.looks.push({ look: lookNo, runs: [], example: exampleRhyme(contexts.get(d)!, index) });
  let toPlay = playing;
  for (let attempt = 1; toPlay.length > 0; attempt++) {
    const replies = await inParallel(toPlay.map((d) => () => {
      const ctx = contexts.get(d)!;
      const look = d.looks.at(-1)!;
      return callModel(playerModel, playerPrompt(ctx.seed.word, ctx.puzzle.seedRespelling, look.example), run, `look-${lookNo}.try-${attempt}`);
    }));
    process.stderr.write("\n");
    const again: Day[] = [];
    toPlay.forEach((d, i) => {
      const reply = replies[i]!;
      note(reply);
      const ctx = contexts.get(d)!;
      const look = d.looks.at(-1)!;
      const words = parsePlayerReply(reply.text);
      const count = keyCount(words, ctx.seed.rhymeKey, (w) => index.rhymeKeysOf(w), offKeyRatio);
      look.runs.push({ attempt, words, keyCount: count, answeredBy: reply.answeredBy });
      const next = lookAttempt(look.runs.map((r) => r.keyCount.offKey));
      if (next === "keep") look.play = playWords(ctx, words);
      else if (next === "re-run") again.push(d);
      else d.result = "untested";
    });
    toPlay = again;
  }

  // Judge every Candidate once, and land what each ruling earns.
  const looked = playing.filter((d) => d.looks.at(-1)!.play);
  const items: (JudgeItem & { day: Day })[] = looked.flatMap((d) =>
    d.looks.at(-1)!.play!.candidates.map((c) => {
      const word = c.word.trim().toLowerCase();
      return { day: d, word, seedWord: d.seed.seedWord, rhymeKey: d.rhymeKey, question: judgeQuestion(wordFacts(index, word), d.rhymeKey) };
    }));
  const { send, ruledBefore } = planJudging(items, readRulings(), parseDeclines(existsSync(DECLINES) ? readFileSync(DECLINES, "utf8") : ""));
  const rhymeCallCount = rhymeCalls(send);
  console.error(`${items.length} Candidates, ${send.filter((i) => "ask" in i.question).length} for the Judge (${ruledBefore.length} ruled on before): ${rhymeCallCount} rhyme calls, then the wordhood question for any that would act`);
  if (rhymeCallCount > maxJudgeCalls) {
    stopped = `look ${lookNo}: the Judge's rhyme leg would take ${rhymeCallCount} calls, over --max-judge-calls ${maxJudgeCalls}`;
    for (const d of looked) d.notChecked = `the Batch stopped before judging look ${lookNo}`;
    break;
  }
  const leg = await runJudge(send, { model: JUDGE_MODEL, run, askWordhood: true, label: `look-${lookNo}` });
  noteLeg(leg);
  const landings = landJudgeLeg(leg, { model: JUDGE_MODEL, date });
  addWrites(writes, landings);
  const recorded = new Map<string, JudgeRulingRecord>(landings.records.map((r) => [rulingKey(r.word, r.rhymeKey), r]));
  for (const { record } of ruledBefore) recorded.set(rulingKey(record.word, record.rhymeKey), record);
  const freshClassification = new Map<string, JudgedItem>(leg.items.map((j) => [rulingKey(j.word, j.rhymeKey), j]));
  for (const j of leg.items) allRulings.push({ ...reportRuling(j), look: lookNo, landed: recorded.get(rulingKey(j.word, j.rhymeKey))?.landed ?? null });

  // Count each day's Trust failures, and give the gate's verdict.
  for (const d of looked) {
    const look = d.looks.at(-1)!;
    const candidates: LookCandidate[] = look.play!.candidates.map((c) => {
      const key = rulingKey(c.word, d.rhymeKey);
      const r = recorded.get(key);
      if (!r) return { word: c.word };
      const fresh = freshClassification.get(key)?.classification;
      return { word: c.word, ruling: { verdict: r.verdict, reachesKey: fresh ? fresh.reachesKey : r.verdict === "rhyme" && readingReachesKey(r.reading, r.rhymeKey), landed: r.landed } };
    });
    look.trustFailures = trustFailures(candidates);
    d.failuresPerLook.push(look.trustFailures.length);
    const verdict = trustVerdict(d.failuresPerLook, gate);
    if (verdict !== "look-again") d.result = verdict;
    console.error(`  ${d.seed.seedWord}: ${look.trustFailures.length} Trust failures${look.trustFailures.length ? ` (${look.trustFailures.join(", ")})` : ""}${d.result ? `, ${d.result}` : ""}`);
  }

  // Rebuild with what landed, so the next look plays on it.
  if (landings.readings.length || landings.unconfirmedRhymes.length) {
    console.error("rebuilding the index with what landed");
    const built = rebuild();
    if (!built.ok) throw new Error(`the index build failed:\n${built.error}`);
    index = loadIndex();
  }
}

for (const d of days) if (!d.result && !d.notChecked) d.notChecked = stopped ? "the Batch stopped before its verdict" : "no verdict was reached";

// ---- No False Accepts ----------------------------------------------------------

let hunt: { days: HuntDay[]; leg: HuntLeg; settled: Settled[]; results: Map<string, NoFalseAcceptsResult> } | null = null;
if (!stopped) {
  const huntDays = planHunt(index, days.filter((d) => !d.notChecked).map((d) => ({ ...d.seed, rhymeKey: d.rhymeKey })), scheduleRaw.scoring, wiktionary);
  const planned = huntCalls(huntDays);
  console.error(`\nNo False Accepts: ${planned.sent} scored Answers to the Judge, ${planned.rhyme} rhyme and ${planned.wordhood} wordhood calls`);
  const leg = await judgeHunt(huntDays, { model: JUDGE_MODEL, run });
  noteLeg(leg);
  const settled = await settleRulingList(rulingList(leg.rulings), { index: () => index, extract: wiktionary, schedule, today: date, loadIndex });
  if (settled.some((s) => s.decision.kind === "demotion")) {
    console.error("rebuilding the index with the Demotions");
    const built = rebuild();
    if (!built.ok) throw new Error(`the index build failed:\n${built.error}`);
  }
  if (settled.some((s) => s.wrote)) index = loadIndex();
  hunt = { days: huntDays, leg, settled, results: huntResults(huntDays, settled, index, scheduleRaw.scoring) };
}

// ---- the report and the record -------------------------------------------------

const result = (d: Day) => d.result ?? null;
const reportPath = writeRunReport(date, stem, run, {
  date,
  command: `batch ${argv.filter((a) => a !== "--yes").join(" ")}`,
  run,
  model: JUDGE_MODEL,
  playerModel,
  answeredBy: [...answeredBy].sort(),
  calls,
  settings: { gate, offKeyRatio, maxJudgeCalls },
  candidatesJudged: allRulings.filter((r) => "knew" in r).length,
  note:
    "A Batch (#267). Trust failures are Candidates the Judge rules a Rhyme with a reading that reaches the key, " +
    "leaving out Unconfirmed Rhymes and suggested Demotions. Every write is listed under writes; the index was " +
    "rebuilt after each look that landed one.",
  ...(stopped ? { stopped } : {}),
  seedsPlayed: days.map((d) => ({
    seedWord: d.seed.seedWord,
    date: d.seed.date,
    rhymeKey: d.rhymeKey,
    played: d.seed.played,
    trust: result(d),
    failuresPerLook: d.failuresPerLook,
    ...(d.notChecked ? { notChecked: d.notChecked } : {}),
    looks: d.looks.map((l) => ({
      look: l.look,
      example: l.example,
      runs: l.runs.map((r) => ({ attempt: r.attempt, offKey: r.keyCount.offKey, keyCount: r.keyCount, wordsTyped: r.words.length, answeredBy: r.answeredBy, words: r.words })),
      ...(l.play
        ? {
            score: l.play.score,
            maxScore: l.play.maxScore,
            share: Number(l.play.share.toFixed(4)),
            rank: l.play.rank,
            candidates: l.play.candidates.map((c) => c.word),
            trustFailures: l.trustFailures ?? null,
          }
        : {}),
    })),
  })),
  untested: days.filter((d) => d.result === "untested").map((d) => ({
    seedWord: d.seed.seedWord, date: d.seed.date, rhymeKey: d.rhymeKey, look: d.looks.length,
    runs: d.looks.at(-1)!.runs.map((r) => r.keyCount),
  })),
  writes,
  rulings: allRulings,
  noFalseAccepts: hunt
    ? {
        note:
          "The hunt (#268): scored Answers with no Wiktionary reading on the Seed Word's Rhyme Key, or in the names data, " +
          "put to the Judge. Nothing it ruled landed by itself; what landed is what the maintainer decided.",
        seeds: hunt.days.map((d) => ({
          seedWord: d.seedWord,
          rhymeKey: d.rhymeKey,
          answers: d.answers,
          ...hunt!.results.get(d.seedWord),
          sent: d.hunted,
        })),
        rulings: hunt.leg.rulings.map((r) => ({
          word: r.answer.word, seedWord: r.seedWord, rhymeKey: r.rhymeKey, reasons: r.answer.reasons,
          verdict: r.rhyme.verdict, reading: r.rhyme.reading, confidence: r.rhyme.confidence, why: r.rhyme.why,
          ...(r.wordhood ? { wordhood: r.wordhood.verdict, wordhoodConfidence: r.wordhood.confidence, wordhoodWhy: r.wordhood.why } : {}),
        })),
        decided: hunt.settled.map((s) => ({ word: s.listed.answer.word, seedWord: s.listed.seedWord, doubts: s.listed.doubts, decision: s.decision, wrote: s.wrote })),
      }
    : null,
});

const reportFromRoot = relative(root, reportPath).replace(/\\/g, "/");
/** The day's No False Accepts result as the record keeps it, when the hunt ran on it. */
function huntEntry(seedWord: string): BatchEntry["noFalseAccepts"] {
  const r = hunt?.results.get(seedWord);
  const day = hunt?.days.find((h) => h.seedWord === seedWord);
  if (!r || !day) return undefined;
  const listed = hunt!.settled.filter((s) => s.listed.seedWord === seedWord).length;
  return { result: r.result, hunted: day.hunted.length, listed, unruled: r.unruled, stillScored: r.stillScored };
}
const entries = days.filter((d) => d.result).map((d) => {
  const noFalseAccepts = huntEntry(d.seed.seedWord);
  return {
    seedWord: d.seed.seedWord,
    entry: {
      date, rhymeKey: d.rhymeKey, trust: d.result!, failuresPerLook: d.failuresPerLook, gate,
      playerModel, judgeModel: JUDGE_MODEL, report: reportFromRoot,
      ...(noFalseAccepts ? { noFalseAccepts } : {}),
    } satisfies BatchEntry,
  };
});
const record = recordBatches(parseBatchRecord(existsSync(BATCHES) ? readFileSync(BATCHES, "utf8") : null), entries);
writeFileSync(BATCHES, serialiseBatchRecord(record));

console.log(`\n## Batch ${from} to ${to}, run ${run}`);
for (const d of days) {
  console.log(`${d.seed.date} ${d.seed.seedWord} /${d.rhymeKey}/: ${d.result ?? `not checked (${d.notChecked})`}, Trust failures per look ${JSON.stringify(d.failuresPerLook)}`);
  const h = huntEntry(d.seed.seedWord);
  if (h) {
    console.log(`  No False Accepts: ${h.result}, ${h.hunted} Answers sent, ${h.listed} listed` +
      `${h.unruled.length ? `, unruled ${h.unruled.join(", ")}` : ""}${h.stillScored.length ? `, still scored ${h.stillScored.join(", ")}` : ""}`);
  }
}
console.log(`calls: ${JSON.stringify(calls)}`);
console.log(`writes: ${writes.readings.length} readings, ${writes.unconfirmedRhymes.length} Unconfirmed Rhymes, ${writes.suggestedDemotions.length} suggested Demotions`);
if (hunt) console.log(`ruled in the sitting: ${hunt.settled.filter((s) => s.wrote).map((s) => s.wrote).join("; ") || "nothing written"}`);
if (stopped) console.log(`stopped: ${stopped}`);
console.log(`report: ${reportFromRoot}\nrecord: data/batches.json\ncommit both with data/supplement.dict, data/demotions.txt, data/unconfirmed-rhymes.txt and data/judge-rulings.jsonl`);
