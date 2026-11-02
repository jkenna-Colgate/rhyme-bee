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
 * The same list then puts every ruling the looks made or met that said Rhyme
 * and landed nothing, whatever its confidence (#293; ADR-0021, 2026-11-02
 * amendment): the maintainer confirms it, which writes the reading beside the
 * word's others, declines it, which records a Decline for the word and the
 * Rhyme Key, or skips it, which writes nothing and is listed in the run report.
 * Last come the words the looks wrote in that have no knownness, each once with
 * the Rhyme Key it was found on (#294): the maintainer Tiers it as an Answer or
 * a Bonus Word, which writes a Tier verdict to `data/tier-overrides.csv` as the
 * Editor's Pass does, or skips it, which writes nothing and is reported. The
 * Judge's answer to its Tier question (would a player think of the word when
 * hunting rhymes for the Seed Word: Retrieval, ADR-0015) is filled in as the
 * default, which Enter accepts and nothing writes by itself (#295); the run
 * report records it beside the ruling, and how often the two agreed.
 * The whole list is put after the Batch's last model call, the Tier question's.
 *
 * It writes the run report to `data/judge-runs/` and the result per Seed Word
 * to `data/batches.json`, both to be committed with what landed.
 *
 * **At the usage limit** (#286) the Batch stops cleanly. Once a call reports
 * either usage window at 90% or over (`USAGE_STOP_AT` in `modelCall.ts`), or a
 * call is refused for the limit, no new call starts, the calls in flight finish
 * and are cached, and the command exits non-zero having written neither the run
 * report nor `data/batches.json`. That leaves the run number unused, and the
 * cache is keyed by it, so the same command run again after the reset replays
 * every call that finished for free and goes on from there. What already landed
 * stays in `data/` and is not sent to the Judge again. To resume, leave every
 * file as it is, commit nothing, and run the command it prints. It cannot stop
 * during the ruling list: the hunt makes all its calls before the list is put.
 * The `--max-judge-calls` stop is a different path, and writes a report.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  batchBlock,
  batchCost,
  candidateGame,
  DEFAULT_OFF_KEY_RATIO,
  DEFAULT_TRUST_GATE,
  JUDGE_CALLS_PER_SEED,
  judgeCallCap,
  keyCount,
  lookAttempt,
  namedBlock,
  parseBatchRecord,
  recordBatches,
  serialiseBatchRecord,
  trustFailures,
  trustVerdict,
  undecidedRhymes,
  untieredWrittenIn,
  type BatchEntry,
  type BatchSeed,
  type KeyCount,
  type LookCandidate,
  type TrustGate,
  type TrustResult,
} from "../src/batch.ts";
import { parseDeclines } from "../src/declines.ts";
import { judgeQuestion, readingReachesKey, TIER_BATCH, type TierRuling } from "../src/judge.ts";
import { planJudging, rulingKey, type JudgeRulingRecord } from "../src/judgeLanding.ts";
import type { PuzzleContext } from "../src/session.ts";
import { exampleRhyme, parsePlayerReply, playerPrompt, playWords, type SyntheticPlay } from "../src/syntheticPlayer.ts";
import {
  addCalls,
  addWrites,
  askTier,
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
import { rulingList, tierAgreement, type NoFalseAcceptsResult, type RulingItem } from "../src/noFalseAccepts.ts";
import {
  huntCalls,
  huntResults,
  judgeHunt,
  loadWiktionary,
  planHunt,
  rebuild,
  sessionOn,
  settledHunted,
  settleRulingList,
  type HuntDay,
  type HuntLeg,
} from "./batchHunt.ts";
import { callModel, exactModelId, inParallel, nextRun, root, today, UsageStopError, writeRunReport, type ModelReply } from "./modelCall.ts";

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
/** The cap given on the command line, if any; the default scales with the Batch (`judgeCallCap`). */
const maxJudgeCallsGiven = flag("max-judge-calls") === undefined ? undefined : number("max-judge-calls", 0);
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
const maxJudgeCalls = judgeCallCap({ seeds: block.length, maxJudgeCalls: maxJudgeCallsGiven });
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
  `    about 1 to 3 a look for 3 Seed Words, and at most ${maxJudgeCalls} rhyme calls a look ` +
  `(${maxJudgeCallsGiven === undefined ? `${JUDGE_CALLS_PER_SEED} per Seed Word; --max-judge-calls overrides it` : "--max-judge-calls"})\n` +
  `  Trust gate: k = ${gate.k} within n = ${gate.n} looks; off key above ${offKeyRatio} to 1\n` +
  `  No False Accepts hunt, Judge (${JUDGE_MODEL}): ${huntPlan.sent} scored Answers sent on today's index, ` +
  `${huntPlan.rhyme} rhyme calls and ${huntPlan.wordhood} wordhood calls (recounted after the looks land)\n` +
  `  Tier question, Judge (${JUDGE_MODEL}): one call per ${TIER_BATCH} words the looks write in with no knownness, ` +
  "after the hunt and before the ruling list; none if they write in none",
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

/** The command that resumes this run, as typed: the same one, whose run number nothing has used yet. */
const resume = `npx tsx scripts/batch.ts ${argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}`;
/**
 * Await calls to the model, and at the usage stop end the sitting with nothing
 * written that would use up the run number (#286): no report and no record.
 */
async function orUsageStop<T>(calls: Promise<T>): Promise<T> {
  try {
    return await calls;
  } catch (e) {
    if (!(e instanceof UsageStopError)) throw e;
    console.error(
      `\n${e.message}. Nothing is lost: the calls made so far are cached and what landed is in data/. ` +
      `Leave the files as they are, don't commit, and run the same command again after the reset to resume:\n  ${resume}`,
    );
    process.exit(1);
  }
}

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
  /** Rhymes not counted because the game accepts them as Bonus Words whose knownness measures them as rare. */
  excusedAsRare?: string[];
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
const calls = { player: 0, rhyme: 0, wordhood: 0, tier: 0, fromCache: 0 };
const answeredBy = new Set<string>();
const allRulings: (ReturnType<typeof reportRuling> & { look: number; landed: string | null })[] = [];
/** Every ruling the looks made or met, from its record: where the Judge's undecided rhymes are picked from (#293). */
const lookRulings: JudgeRulingRecord[] = [];
/** The rulings this Batch's looks made, not met: where the written-in words to Tier are picked from (#294). */
const writtenIn: JudgeRulingRecord[] = [];
const readDeclines = () => parseDeclines(existsSync(DECLINES) ? readFileSync(DECLINES, "utf8") : "");
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
    const replies = await orUsageStop(inParallel(toPlay.map((d) => () => {
      const ctx = contexts.get(d)!;
      const look = d.looks.at(-1)!;
      return callModel(playerModel, playerPrompt(ctx.seed.word, ctx.puzzle.seedRespelling, look.example), run, `look-${lookNo}.try-${attempt}`);
    })));
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
  const { send, ruledBefore } = planJudging(items, readRulings(), readDeclines());
  const rhymeCallCount = rhymeCalls(send);
  console.error(`${items.length} Candidates, ${send.filter((i) => "ask" in i.question).length} for the Judge (${ruledBefore.length} ruled on before): ${rhymeCallCount} rhyme calls, then the wordhood question for any that would act`);
  if (rhymeCallCount > maxJudgeCalls) {
    stopped = `look ${lookNo}: the Judge's rhyme leg would take ${rhymeCallCount} calls, over --max-judge-calls ${maxJudgeCalls}`;
    for (const d of looked) d.notChecked = `the Batch stopped before judging look ${lookNo}`;
    break;
  }
  const leg = await orUsageStop(runJudge(send, { model: JUDGE_MODEL, run, askWordhood: true, label: `look-${lookNo}` }));
  noteLeg(leg);
  const landings = landJudgeLeg(leg, { model: JUDGE_MODEL, date });
  addWrites(writes, landings);
  const recorded = new Map<string, JudgeRulingRecord>(landings.records.map((r) => [rulingKey(r.word, r.rhymeKey), r]));
  for (const { record } of ruledBefore) recorded.set(rulingKey(record.word, record.rhymeKey), record);
  lookRulings.push(...recorded.values());
  writtenIn.push(...landings.records);
  const freshClassification = new Map<string, JudgedItem>(leg.items.map((j) => [rulingKey(j.word, j.rhymeKey), j]));
  for (const j of leg.items) allRulings.push({ ...reportRuling(j), look: lookNo, landed: recorded.get(rulingKey(j.word, j.rhymeKey))?.landed ?? null });

  // Rebuild with what landed, so the next look plays on it and this look's
  // Candidates are counted on what the game now does with them.
  if (landings.readings.length || landings.unconfirmedRhymes.length) {
    console.error("rebuilding the index with what landed");
    const built = rebuild();
    if (!built.ok) throw new Error(`the index build failed:\n${built.error}`);
    index = loadIndex();
  }

  // Count each day's Trust failures, and give the gate's verdict.
  for (const d of looked) {
    const look = d.looks.at(-1)!;
    const seed = contexts.get(d)!.seed;
    const candidates: LookCandidate[] = look.play!.candidates.map((c) => {
      const key = rulingKey(c.word, d.rhymeKey);
      const r = recorded.get(key);
      if (!r) return { word: c.word };
      const fresh = freshClassification.get(key)?.classification;
      return {
        word: c.word,
        ruling: { verdict: r.verdict, reachesKey: fresh ? fresh.reachesKey : r.verdict === "rhyme" && readingReachesKey(r.reading, r.rhymeKey), landed: r.landed },
        game: candidateGame(index.adjudicate(seed, c.word)),
      };
    });
    const trust = trustFailures(candidates, index.knownnessThreshold);
    look.trustFailures = trust.failures;
    look.excusedAsRare = trust.excusedAsRare;
    d.failuresPerLook.push(trust.failures.length);
    const verdict = trustVerdict(d.failuresPerLook, gate);
    if (verdict !== "look-again") d.result = verdict;
    console.error(
      `  ${d.seed.seedWord}: ${trust.failures.length} Trust failures${trust.failures.length ? ` (${trust.failures.join(", ")})` : ""}` +
      `${trust.excusedAsRare.length ? `, ${trust.excusedAsRare.length} excused as rare Bonus Words (${trust.excusedAsRare.join(", ")})` : ""}` +
      `${d.result ? `, ${d.result}` : ""}`,
    );
  }
}

for (const d of days) if (!d.result && !d.notChecked) d.notChecked = stopped ? "the Batch stopped before its verdict" : "no verdict was reached";

// ---- No False Accepts ----------------------------------------------------------

let hunted: { days: HuntDay[]; leg: HuntLeg } | null = null;
if (!stopped) {
  const huntDays = planHunt(index, days.filter((d) => !d.notChecked).map((d) => ({ ...d.seed, rhymeKey: d.rhymeKey })), scheduleRaw.scoring, wiktionary);
  const planned = huntCalls(huntDays);
  console.error(`\nNo False Accepts: ${planned.sent} scored Answers to the Judge, ${planned.rhyme} rhyme and ${planned.wordhood} wordhood calls`);
  const leg = await orUsageStop(judgeHunt(huntDays, { model: JUDGE_MODEL, run }));
  noteLeg(leg);
  hunted = { days: huntDays, leg };
}

// ---- the Tier question ---------------------------------------------------------
//
// Asked of each word the looks wrote in that has no knownness, before the ruling
// list starts, so it is the Batch's last model call (#295). Its answer lands
// nothing: it is the maintainer's default on the list. A Batch stopped at the
// call cap asks nothing more, and its words are put to the maintainer without one.

const untiered = untieredWrittenIn(writtenIn, (word) => index.tierOf(word).knownness);
let tierRulings = new Map<string, TierRuling>();
if (!stopped && untiered.length) {
  console.error(`\nThe Tier question: ${untiered.length} words written in with no knownness, ${Math.ceil(untiered.length / TIER_BATCH)} calls`);
  const asked = await orUsageStop(askTier(untiered, { model: JUDGE_MODEL, run, label: "tier" }));
  calls.tier += asked.calls.tier;
  calls.fromCache += asked.calls.fromCache;
  asked.answeredBy.forEach((m) => answeredBy.add(m));
  tierRulings = asked.rulings;
}

// ---- the ruling list -----------------------------------------------------------
//
// Put only now, after the Batch's last model call, so a usage stop never lands
// while the maintainer is typing (#293): the hunted Answers the Judge doubts,
// then the rhymes it ruled in the looks and left undecided, then the words the
// looks wrote in that have no knownness, to Tier (#294) with the Judge's answer
// filled in (#295).

const undecided = undecidedRhymes(lookRulings, readDeclines());
const rulingItems: RulingItem[] = [
  ...(hunted ? rulingList(hunted.leg.rulings).map((listed): RulingItem => ({ kind: "hunted", listed })) : []),
  ...undecided.map((rhyme): RulingItem => ({ kind: "undecided", rhyme })),
  ...untiered.map((word): RulingItem => {
    const judge = tierRulings.get(word.word);
    return judge ? { kind: "tier", untiered: word, judge } : { kind: "tier", untiered: word };
  }),
];
const settled = await settleRulingList(rulingItems, { index: () => index, extract: wiktionary, schedule, today: date, loadIndex });
if (settled.some((s) => s.decision.kind === "demotion" || s.decision.kind === "tier")) {
  console.error("rebuilding the index with the Demotions and Tier verdicts");
  const built = rebuild();
  if (!built.ok) throw new Error(`the index build failed:\n${built.error}`);
}
if (settled.some((s) => s.wrote)) index = loadIndex();
const hunt: { days: HuntDay[]; leg: HuntLeg; settled: ReturnType<typeof settledHunted>; results: Map<string, NoFalseAcceptsResult> } | null = hunted
  ? { ...hunted, settled: settledHunted(settled), results: huntResults(hunted.days, settled, index, scheduleRaw.scoring) }
  : null;
const undecidedSettled = settled.flatMap((s) => (s.item.kind === "undecided" ? [{ rhyme: s.item.rhyme, decision: s.decision, wrote: s.wrote }] : []));
const undecidedSkipped = undecidedSettled.filter((s) => s.decision.kind === "unruled").map((s) => `${s.rhyme.word} /${s.rhyme.rhymeKey}/`);
const tierSettled = settled.flatMap((s) =>
  s.item.kind === "tier" ? [{ untiered: s.item.untiered, judge: s.item.judge, decision: s.decision, wrote: s.wrote }] : []);
const tierAgreed = tierAgreement(tierSettled);
const tierSkipped = tierSettled.filter((s) => s.decision.kind === "unruled").map((s) => `${s.untiered.word} /${s.untiered.rhymeKey}/`);

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
    "leaving out Unconfirmed Rhymes and suggested Demotions; a Rhyme the game accepts, after the look's corrections, " +
    "as a Bonus Word whose knownness is below the Answer line is listed under excusedAsRare and not counted. Every write is listed under writes; the index was " +
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
            excusedAsRare: l.excusedAsRare ?? null,
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
  undecidedRhymes: {
    note:
      "Rulings of the Judge's in the looks that said Rhyme and landed nothing, whatever their confidence, put to the maintainer " +
      "in the sitting (#293). A confirm wrote its reading beside the word's others, a decline a Decline for the word and the Rhyme Key; " +
      "a skip wrote nothing and is listed under skipped.",
    listed: undecidedSettled.length,
    decided: undecidedSettled.map(({ rhyme, decision, wrote }) => ({
      word: rhyme.word, seedWord: rhyme.seedWord, rhymeKey: rhyme.rhymeKey, knew: rhyme.knew, confidence: rhyme.confidence,
      reading: rhyme.heard, why: rhyme.why, decision, wrote,
    })),
    skipped: undecidedSkipped,
  },
  tiered: {
    note:
      "Words the looks wrote in that have no knownness, so each was a Bonus Word whatever it is, put to the maintainer to Tier " +
      "in the sitting (#294), with the Judge's answer to the Tier question as the default (#295). An Answer or a Bonus Word " +
      "wrote an unlocked Tier verdict to data/tier-overrides.csv, which the next build applies; a skip wrote nothing and is " +
      "listed under skipped. The Judge's answer landed nothing by itself. agreement compares it with the maintainer's ruling " +
      "over the words both answered, overall and at each confidence ([agreed, compared]).",
    listed: tierSettled.length,
    decided: tierSettled.map(({ untiered: u, judge, decision, wrote }) => ({
      word: u.word, seedWord: u.seedWord, rhymeKey: u.rhymeKey,
      judge: judge ? { verdict: judge.verdict, confidence: judge.confidence, why: judge.why } : null,
      decision, agreed: judge && judge.verdict !== "no-ruling" && decision.kind === "tier" ? decision.tier === judge.verdict : null, wrote,
    })),
    skipped: tierSkipped,
    agreement: tierAgreed,
  },
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
if (settled.length) console.log(`ruled in the sitting: ${settled.filter((s) => s.wrote).map((s) => s.wrote).join("; ") || "nothing written"}`);
if (undecidedSettled.length) {
  const count = (kind: string) => undecidedSettled.filter((s) => s.decision.kind === kind).length;
  console.log(`rhymes the Judge left undecided: ${undecidedSettled.length}, confirmed ${count("confirm")}, declined ${count("decline")}` +
    `${undecidedSkipped.length ? `, skipped ${undecidedSkipped.join(", ")}` : ""}`);
}
if (tierSettled.length) {
  const tiered = (tier: string) => tierSettled.filter((s) => s.decision.kind === "tier" && s.decision.tier === tier).length;
  console.log(`written-in words with no knownness: ${tierSettled.length}, Tiered Answer ${tiered("answer")}, Bonus Word ${tiered("bonus")}` +
    `${tierSkipped.length ? `, skipped ${tierSkipped.join(", ")}` : ""}` +
    `; agreed with the Judge on ${tierAgreed.agreed} of ${tierAgreed.compared} compared`);
}
if (stopped) console.log(`stopped: ${stopped}`);
console.log(
  `report: ${reportFromRoot}\nrecord: data/batches.json\ncommit both with data/supplement.dict, data/demotions.txt, data/declines.txt, ` +
  "data/tier-overrides.csv, data/unconfirmed-rhymes.txt and data/judge-rulings.jsonl",
);
