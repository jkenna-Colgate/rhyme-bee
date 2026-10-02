/**
 * TASK, throwaway (#224). Where does a player's gap to Laureate live?
 *
 * Splits each scheduled day's maximum Score into rare Answers, common
 * transparent compounds (the ADR-0015 Retrieval gap's structural proxy) and
 * common native Answers, then replays one Synthetic Player run per model per
 * day (the #223 instrument, same prompt, same cache) to see which of that mass
 * goes unfound and what each lever would move. Not tested, not wired in.
 *
 *   npx tsx scripts/gap-to-laureate.task.ts [--weeks 1,2,3,4,9] [--sweep haiku=1,sonnet=1]
 *
 * Without --sweep it only reports on the runs already cached in
 * .scratch/synthetic-player/ (gitignored). A failed model call is skipped, not
 * fatal, so a sweep cut short by a rate limit resumes on the next invocation.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PREFIX_SPELLINGS } from "../src/affixes.ts";
import type { PuzzleEntry } from "../src/rhymeIndex.ts";
import { isRare, type ScoringConfig } from "../src/scoring.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { applySubmission, emptyPlayState, startSession, type PuzzleContext } from "../src/session.ts";

const root = resolve(import.meta.dirname, "..");
const cacheDir = resolve(root, ".scratch/synthetic-player");
mkdirSync(cacheDir, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(
  JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")) as SerialisedIndex,
);
interface Day { date: string; weekday: string; week: number; seed: string; rhymeKey: string; difficulty: number }
const schedule = JSON.parse(readFileSync(resolve(root, "data/schedule.json"), "utf8")) as { scoring: ScoringConfig; days: Day[] };
const config = schedule.scoring;
const wordList = new Set(readFileSync(resolve(root, "data/words.txt"), "utf8").split(/\r?\n/));
const prefixes = new Set(PREFIX_SPELLINGS);
const HEAD_KNOWNNESS = 2.0;

const args = process.argv.slice(2);
const sweepAt = args.indexOf("--sweep");
const sweep = sweepAt < 0 ? [] : args[sweepAt + 1]!.split(",").map((s) => { const [m, n] = s.split("="); return { model: m!, n: Number(n) }; });

// ---- the days, and each Answer's class ------------------------------------

type Class = "rare" | "compound" | "native";
const CLASSES: Class[] = ["native", "compound", "rare"];

interface DayCtx { day: Day; ctx: PuzzleContext; classOf: Map<string, Class>; mass: Record<Class, number>; n: number }
const days: DayCtx[] = [];
const unpinnable: string[] = [];

/**
 * A common Answer is a transparent compound when it is a head stuck on the
 * front of another member of the same family (`sidekick` on `kick`,
 * `unexplored` on `explored`), the head being a prefix or a well-known word
 * of three letters or more. A structural proxy for the Retrieval gap, not a
 * measure: read by hand, about nine in ten flagged words with a prefix or a
 * longer head are real compounds, and about seven in ten with a three-letter
 * head (`for+mats` and `car+ess` get through; `ins+tall` and `com+pares` do not).
 */
function isCompound(word: string, family: Set<string>): boolean {
  for (let i = 2; i <= word.length - 3; i++) {
    if (!family.has(word.slice(i))) continue;
    const head = word.slice(0, i);
    if (prefixes.has(head)) return true;
    if (head.length >= 3 && index.hasWord(head) && (index.tierOf(head).knownness ?? 0) >= HEAD_KNOWNNESS) return true;
  }
  return false;
}

for (const day of schedule.days) {
  let ctx: PuzzleContext;
  try { ctx = startSession(index, index.pinSeed(day.seed, day.rhymeKey as never), config); }
  catch { unpinnable.push(`${day.date} ${day.seed}`); continue; }
  const family = new Set([day.seed, ...ctx.puzzle.answers.map((a) => a.word), ...ctx.puzzle.bonusWords.map((a) => a.word)]);
  const classOf = new Map<string, Class>();
  const mass: Record<Class, number> = { native: 0, compound: 0, rare: 0 };
  for (const a of ctx.puzzle.answers) {
    const c: Class = isRare(a.knownness, config) ? "rare" : isCompound(a.word, family) ? "compound" : "native";
    classOf.set(a.word, c);
    mass[c] += ctx.answerScores.get(a.word)! / ctx.maxScore;
  }
  days.push({ day, ctx, classOf, mass, n: ctx.puzzle.answers.length });
}

// The Synthetic Player is run on whole schedule weeks, not on days picked for a fix.
const weeksAt = args.indexOf("--weeks");
const weeks = weeksAt < 0 ? null : new Set(args[weeksAt + 1]!.split(",").map(Number));
const sample = weeks ? days.filter((d) => weeks.has(d.day.week)) : days;

// ---- gather runs (same prompt and cache as the #223 prototype) -------------

function prompt(seed: string, respelling: string): string {
  return [
    `You are playing a daily word game called Rhyming Bee. You are an ordinary adult American player:`,
    `not a poet, no rhyming dictionary, no internet. The game shows you one word and reads it aloud:`,
    ``,
    `  "${seed}" (pronounced ${respelling})`,
    ``,
    `Type in as many real English words as you can that rhyme with it. Names don't count.`,
    `Play the way you really would: write every word you would come up with and type in during a relaxed`,
    `session of about fifteen minutes, and stop when you would run out of ideas.`,
    `Output only the words, one per line, lowercase, nothing else.`,
  ].join("\n");
}

interface RunRecord { words: string[]; costUsd: number | null; durationMs: number; raw: string }

function callModel(model: string, text: string): Promise<RunRecord> {
  return new Promise((done, fail) => {
    const started = Date.now();
    // cwd outside the repo so the player never loads CLAUDE.md, CONTEXT.md or the answer data.
    const child = spawn("claude", ["-p", "--model", model, "--output-format", "json"], { shell: true, cwd: tmpdir() });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error(`claude exited ${code}: ${err.slice(0, 200)} ${out.slice(0, 200)}`);
        const json = JSON.parse(out);
        if (json.is_error) throw new Error(`claude reported an error: ${String(json.result).slice(0, 200)}`);
        const raw: string = json.result ?? "";
        const words = raw.split(/\r?\n/).map((w) => w.trim().toLowerCase().replace(/^[-*\d.\s]+/, "")).filter((w) => /^[a-z' -]+$/.test(w));
        if (words.length < 3) throw new Error(`no word list in the reply: ${raw.slice(0, 120)}`);
        done({ words, costUsd: json.total_cost_usd ?? null, durationMs: Date.now() - started, raw });
      } catch (e) { fail(e); }
    });
    child.stdin.end(text);
  });
}

const cachePath = (seed: string, model: string, r: number) => resolve(cacheDir, `${seed}.${model}.${r}.json`);

if (sweep.length) {
  const jobs: (() => Promise<void>)[] = [];
  let failedInARow = 0;
  let made = 0;
  for (const { model, n } of sweep) for (let r = 0; r < n; r++) for (const { day, ctx } of sample) {
    const path = cachePath(day.seed, model, r);
    if (existsSync(path)) continue;
    jobs.push(async () => {
      if (failedInARow >= 8) return;
      try {
        const rec = await callModel(model, prompt(day.seed, ctx.puzzle.seedRespelling));
        writeFileSync(path, JSON.stringify(rec, null, 1));
        failedInARow = 0;
        if (++made % 20 === 0) process.stderr.write(`  ${made}/${jobs.length} runs made\n`);
      } catch (e) {
        failedInARow++;
        process.stderr.write(`  FAILED ${day.seed} ${model}#${r}: ${(e as Error).message}\n`);
      }
    });
  }
  process.stderr.write(`Calling the model ${jobs.length} times...\n`);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await jobs[next++]!(); }));
  process.stderr.write(failedInARow >= 8 ? `Stopped after 8 failures in a row; ${made} runs made.\n` : `Done; ${made} runs made.\n`);
}

// ---- helpers ---------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const pct = (x: number) => (Number.isNaN(x) ? "  n/a" : `${(100 * x).toFixed(0)}%`.padStart(5));
const num = (x: number, d = 1) => (Number.isNaN(x) ? "n/a" : x.toFixed(d)).padStart(6);
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const spread = (xs: number[], f: (x: number) => string) => `mean ${f(mean(xs))}  p10 ${f(quant(xs, 0.1))}  median ${f(quant(xs, 0.5))}  p90 ${f(quant(xs, 0.9))}`;
const LAUREATE = 0.7;
const SIZE_BUCKETS: [string, number, number][] = [["20-39", 0, 39], ["40-59", 40, 59], ["60-79", 60, 79], ["80-120", 80, 999]];

// ---- part 1: the structure of the schedule, no player involved --------------

console.log(`# Where does a player's gap to Laureate live? (#224)\n`);
console.log(`Index ${manifest.index}. ${schedule.days.length} scheduled days, ${days.length} playable, ` +
  `${unpinnable.length} cannot be pinned and fall back to Free Play (${unpinnable.join(", ")}).`);
console.log(`Laureate is ${100 * LAUREATE}% of maximum Score. An Answer is rare below knownness ${config.rareKnownnessCutoff}.\n`);

console.log(`## 1. What the maximum Score is made of (no player, all ${days.length} days)\n`);
console.log(`  Answers per day        ${spread(days.map((d) => d.n), (x) => num(x, 0))}`);
for (const c of CLASSES) console.log(`  ${(c + " share of max").padEnd(22)} ${spread(days.map((d) => d.mass[c]), pct)}`);

// A player who finds Answers strictly best-known first: how many, and how deep, to Laureate?
const need: number[] = [], depth: number[] = [], needShare: number[] = [];
for (const d of days) {
  const sorted = [...d.ctx.puzzle.answers].sort((a, b) => (b.knownness ?? -9) - (a.knownness ?? -9));
  let acc = 0, k = 0;
  while (acc / d.ctx.maxScore < LAUREATE) acc += d.ctx.answerScores.get(sorted[k++]!.word)!;
  need.push(k); needShare.push(k / d.n); depth.push(sorted[k - 1]!.knownness ?? 0);
}
console.log(`\n  Finding Answers strictly best-known first, Laureate takes:`);
console.log(`    Answers found        ${spread(need, (x) => num(x, 0))}`);
console.log(`    share of the Answers ${spread(needShare, pct)}`);
console.log(`    knownness reached    ${spread(depth, (x) => num(x, 2))}`);
const can = (f: (d: DayCtx) => number) => `${days.filter((d) => f(d) >= LAUREATE).length}/${days.length}`;
console.log(`\n  Days where Laureate is reachable without a single rare Answer:            ${can((d) => 1 - d.mass.rare)}`);
console.log(`  Days where it is reachable on native common Answers alone (no compounds): ${can((d) => d.mass.native)}`);
console.log(`\n  Classifier spot check, compound Answers of five days:`);
for (const d of days.filter((_, i) => i % 50 === 7)) {
  console.log(`    ${d.day.seed}: ${d.ctx.puzzle.answers.filter((a) => d.classOf.get(a.word) === "compound").map((a) => a.word).slice(0, 14).join(", ") || "(none)"}`);
}

// ---- part 2: replay the cached Synthetic Player runs ------------------------

interface Run {
  d: DayCtx; share: number; submitted: number; found: number;
  missing: Record<Class, number>;            // share of max Score left unfound, by class
  foundCount: Record<Class, number>; total: Record<Class, number>;
  foundMass: Record<Class, number>;
  nativeHigh: [number, number];              // [found, total] native Answers with knownness >= 2.2
  rejNoReading: number; rejNotOnList: number; rejNoRhyme: number; bonus: number;
  firstNoReadingAt: number | null;           // 0-based position of the first missing-reading rejection
  afterFirstNoReading: number | null;        // Answers found after it
  neverFound: PuzzleEntry[];
}

function replay(d: DayCtx, rec: RunRecord): Run {
  let state = emptyPlayState;
  const run: Run = {
    d, share: 0, submitted: rec.words.length, found: 0,
    missing: { native: 0, compound: 0, rare: 0 }, foundCount: { native: 0, compound: 0, rare: 0 },
    total: { native: 0, compound: 0, rare: 0 }, foundMass: { native: 0, compound: 0, rare: 0 },
    nativeHigh: [0, 0], rejNoReading: 0, rejNotOnList: 0, rejNoRhyme: 0, bonus: 0,
    firstNoReadingAt: null, afterFirstNoReading: null, neverFound: [],
  };
  rec.words.forEach((w, i) => {
    const { state: next, result } = applySubmission(d.ctx, state, w);
    state = next;
    if (!result) return;
    const v = result.verdict;
    if (v.outcome === "answer" && run.firstNoReadingAt !== null) run.afterFirstNoReading!++;
    if (v.outcome === "bonus") run.bonus++;
    if (v.outcome !== "rejected") return;
    if (v.reason === "does-not-rhyme") run.rejNoRhyme++;
    if (v.reason !== "not-a-known-word") return;
    if (!wordList.has(w)) { run.rejNotOnList++; return; }
    run.rejNoReading++;
    if (run.firstNoReadingAt === null) { run.firstNoReadingAt = i; run.afterFirstNoReading = 0; }
  });
  const found = new Set(state.foundAnswers);
  run.found = found.size;
  for (const a of d.ctx.puzzle.answers) {
    const c = d.classOf.get(a.word)!;
    const m = d.ctx.answerScores.get(a.word)! / d.ctx.maxScore;
    run.total[c]++;
    const high = c === "native" && (a.knownness ?? 0) >= 2.2;
    if (high) run.nativeHigh[1]++;
    if (found.has(a.word)) { run.foundCount[c]++; run.foundMass[c] += m; run.share += m; if (high) run.nativeHigh[0]++; }
    else { run.missing[c] += m; run.neverFound.push(a); }
  }
  return run;
}

const models = ["haiku", "sonnet"];
const runsOf = new Map<string, Run[]>();
for (const model of models) {
  const runs: Run[] = [];
  for (const d of sample) {
    const path = cachePath(d.day.seed, model, 0);
    if (existsSync(path)) runs.push(replay(d, JSON.parse(readFileSync(path, "utf8")) as RunRecord));
  }
  if (runs.length) runsOf.set(model, runs);
}

const rate = (runs: Run[], line: number, f: (r: Run) => number = (r) => r.share) => `${runs.filter((r) => f(r) >= line - 1e-9).length}/${runs.length}`.padStart(8);
const pooled = (runs: Run[], c: Class) => runs.reduce((a, r) => a + r.foundCount[c], 0) / runs.reduce((a, r) => a + r.total[c], 0);

for (const [model, runs] of runsOf) {
  console.log(`\n## 2. Synthetic Player, ${model}: one run on each of ${runs.length} days${weeks ? ` (schedule weeks ${[...weeks].join(", ")}, whole)` : ""}\n`);
  console.log(`  Rank%                  ${spread(runs.map((r) => r.share), pct)}`);
  console.log(`  words typed            ${spread(runs.map((r) => r.submitted), (x) => num(x, 0))}`);
  console.log(`  Answers found          ${spread(runs.map((r) => r.found), (x) => num(x, 0))}`);

  console.log(`\n  ### The missing share, split by where the unfound Score sits (mean over days)`);
  const gap = mean(runs.map((r) => 1 - r.share));
  console.log(`    missing in total                 ${pct(gap)}`);
  for (const c of CLASSES) {
    const m = mean(runs.map((r) => r.missing[c]));
    console.log(`    ${(c === "native" ? "common native Answers" : c === "compound" ? "common compounds" : "rare Answers").padEnd(32)} ${pct(m)}  (${pct(m / gap)} of the gap; ` +
      `${pct(pooled(runs, c))} of these Answers found)`);
  }
  const short = runs.filter((r) => r.share < LAUREATE);
  console.log(`    On the ${short.length} days short of Laureate, the shortfall to the 70% line averages ${pct(mean(short.map((r) => LAUREATE - r.share)))} of max.`);

  console.log(`\n  ### Size: by Answers per day`);
  console.log(`    Answers   days   Rank%  Laureate   typed   found  native>=2.2 found`);
  for (const [label, lo, hi] of SIZE_BUCKETS) {
    const b = runs.filter((r) => r.d.n >= lo && r.d.n <= hi);
    if (!b.length) continue;
    const hi22 = b.reduce((a, r) => a + r.nativeHigh[0], 0) / b.reduce((a, r) => a + r.nativeHigh[1], 0);
    console.log(`    ${label.padEnd(8)} ${String(b.length).padStart(5)}   ${pct(mean(b.map((r) => r.share)))}  ${rate(b, LAUREATE)}  ${num(mean(b.map((r) => r.submitted)), 0)}  ${num(mean(b.map((r) => r.found)), 0)}  ${pct(hi22)}`);
  }
  const share = runs.map((r) => r.share);
  console.log(`    Rank% correlates with: Answers per day r=${pearson(share, runs.map((r) => r.d.n)).toFixed(2)}, ` +
    `Difficulty r=${pearson(share, runs.map((r) => r.d.mass.rare)).toFixed(2)}, ` +
    `compound share r=${pearson(share, runs.map((r) => r.d.mass.compound)).toFixed(2)}`);
  console.log(`    Answers found correlates with Answers per day r=${pearson(runs.map((r) => r.found), runs.map((r) => r.d.n)).toFixed(2)}`);

  console.log(`\n  ### Difficulty: by weekday (the schedule ramps Mon to Sun)`);
  for (const wd of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const b = runs.filter((r) => r.d.day.weekday === wd);
    if (b.length) console.log(`    ${wd}  days ${String(b.length).padStart(3)}  Difficulty ${pct(mean(b.map((r) => r.d.mass.rare)))}  Answers ${num(mean(b.map((r) => r.d.n)), 0)}  Rank% ${pct(mean(b.map((r) => r.share)))}  Laureate ${rate(b, LAUREATE)}`);
  }

  console.log(`\n  ### What each lever would move (same runs, re-scored)`);
  const without = (drop: Class[]) => (r: Run) => {
    const keep = CLASSES.filter((c) => !drop.includes(c));
    return keep.reduce((a, c) => a + r.foundMass[c], 0) / keep.reduce((a, c) => a + r.d.mass[c], 0);
  };
  const row = (label: string, rs: Run[], f: (r: Run) => number, line = LAUREATE) =>
    console.log(`    ${label.padEnd(58)} Rank% ${pct(mean(rs.map(f)))}  Laureate ${rate(rs, line, f)}`);
  row("as shipped", runs, (r) => r.share);
  row("Tier: every rare Answer becomes a Bonus Word", runs, without(["rare"]));
  row("Tier: every common compound becomes a Bonus Word", runs, without(["compound"]));
  row("Tier: both", runs, without(["rare", "compound"]));
  for (const cap of [60, 40]) row(`Size: band capped at ${cap} Answers (days kept)`, runs.filter((r) => r.d.n <= cap), (r) => r.share);
  for (const cap of [60, 40]) row(`Size capped at ${cap} and compounds to Bonus`, runs.filter((r) => r.d.n <= cap), without(["compound"]));
  for (const line of [0.6, 0.5, 0.4]) row(`Ladder: Laureate line at ${100 * line}%`, runs, (r) => r.share, line);
  row("Ladder at 50% and compounds to Bonus", runs, without(["compound"]), 0.5);

  console.log(`\n  ### Rejections: exposure to the trust-drives-effort cause`);
  console.log(`    per run: ${num(mean(runs.map((r) => r.rejNoReading)))} on the word list with no reading, ${num(mean(runs.map((r) => r.rejNotOnList)))} not on the word list, ` +
    `${num(mean(runs.map((r) => r.rejNoRhyme)))} does-not-rhyme, ${num(mean(runs.map((r) => r.bonus)))} Bonus Words`);
  const hit = runs.filter((r) => r.firstNoReadingAt !== null);
  console.log(`    ${hit.length}/${runs.length} runs meet at least one missing-reading rejection; the first comes at word ` +
    `${num(quant(hit.map((r) => r.firstNoReadingAt! + 1), 0.5), 0).trim()} (median), with ${num(mean(hit.map((r) => r.afterFirstNoReading!)), 0).trim()} Answers still found after it (mean).`);
  console.log(`    If every Session stopped dead at that first rejection: Rank% would lose ` +
    `${pct(mean(hit.map((r) => r.afterFirstNoReading! / Math.max(1, r.found) * r.share)))} of max on those days (an upper bound, not an estimate).`);

  const freq = new Map<string, number>();
  for (const r of runs) for (const a of r.neverFound) if (r.d.classOf.get(a.word) === "native" && (a.knownness ?? 0) >= 2.2) freq.set(`${a.word} (${r.d.day.seed})`, a.knownness!);
  console.log(`\n  ### Best-known native Answers this run never produced (sample of ${freq.size})`);
  console.log(`    ${[...freq].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w).join(", ")}`);
}

if (runsOf.size === 2) {
  const [h, s] = [runsOf.get("haiku")!, runsOf.get("sonnet")!];
  const sBy = new Map(s.map((r) => [r.d.day.date, r]));
  const both = h.filter((r) => sBy.has(r.d.day.date));
  console.log(`\n## 3. Do the two models agree on which days are hard? (${both.length} days with both)\n`);
  console.log(`  Rank% haiku vs sonnet across days: r=${pearson(both.map((r) => r.share), both.map((r) => sBy.get(r.d.day.date)!.share)).toFixed(2)}; ` +
    `mean gap ${pct(mean(both.map((r) => sBy.get(r.d.day.date)!.share - r.share)))}`);
}

// How much of a day's Rank% is the day and how much is the dice? Only the 13 #223 days have repeat runs.
console.log(`\n## 4. Run-to-run noise (days with repeat runs from #223)\n`);
for (const model of models) {
  const sds: number[] = [];
  for (const d of days) {
    const shares: number[] = [];
    for (let r = 0; existsSync(cachePath(d.day.seed, model, r)); r++) shares.push(replay(d, JSON.parse(readFileSync(cachePath(d.day.seed, model, r), "utf8")) as RunRecord).share);
    if (shares.length > 1) sds.push(Math.sqrt(mean(shares.map((s) => (s - mean(shares)) ** 2))));
  }
  const across = runsOf.get(model)?.map((r) => r.share) ?? [];
  const sdAcross = Math.sqrt(mean(across.map((s) => (s - mean(across)) ** 2)));
  console.log(`  ${model}: within-day SD of Rank% ${pct(mean(sds))} over ${sds.length} days; across-day SD ${pct(sdAcross)} over ${across.length} days`);
}
