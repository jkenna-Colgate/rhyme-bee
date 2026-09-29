/**
 * PROTOTYPE, throwaway (#223). A Synthetic Player: an LLM prompted as an
 * ordinary player, whose words are submitted to the real engine. Answers
 * "can this instrument measure the Playability Bar well enough to believe?"
 * and nothing else. Not tested, not wired into anything.
 *
 *   npx tsx scripts/synthetic-player.prototype.ts [--runs haiku=3,sonnet=2] [seed ...]
 *
 * Raw LLM output is cached in .scratch/synthetic-player/ (gitignored), so a
 * re-run only calls the model for runs it has not already made.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { applySubmission, emptyPlayState, rank, score, startSession } from "../src/session.ts";
import type { ScoringConfig } from "../src/scoring.ts";

const root = resolve(import.meta.dirname, "..");
const cacheDir = resolve(root, ".scratch/synthetic-player");
mkdirSync(cacheDir, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(
  JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")) as SerialisedIndex,
);
const schedule = JSON.parse(readFileSync(resolve(root, "data/schedule.json"), "utf8"));
const config: ScoringConfig = schedule.scoring;
const wordList = new Set(readFileSync(resolve(root, "data/words.txt"), "utf8").split(/\r?\n/));

interface Appeal { word: string; seedWord: string; seedRhymeKey: string; reason: string }
const appeals: Appeal[] = readFileSync(resolve(root, "data/supplement-candidates.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

// Six Seeds with the most real Appeals, then the week of 2026-09-28.
const DEFAULT_SEEDS = [
  "smallpox", "wall", "trick", "booze", "landlord", "win",
  "mug", "klutz", "delusion", "microbiologist", "litter", "hut", "dish",
];

const args = process.argv.slice(2);
let runsSpec = "haiku=3,sonnet=2";
const seeds: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--runs") runsSpec = args[++i]!;
  else seeds.push(args[i]!);
}
const runs = runsSpec.split(",").map((s) => { const [m, n] = s.split("="); return { model: m!, n: Number(n) }; });
const seedList = seeds.length ? seeds : DEFAULT_SEEDS;

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
      if (code !== 0) return fail(new Error(`claude exited ${code}: ${err}`));
      const json = JSON.parse(out);
      const raw: string = json.result ?? "";
      const words = raw.split(/\r?\n/).map((w) => w.trim().toLowerCase().replace(/^[-*\d.\s]+/, "")).filter((w) => /^[a-z' -]+$/.test(w));
      done({ words, costUsd: json.total_cost_usd ?? null, durationMs: Date.now() - started, raw });
    });
    child.stdin.end(text);
  });
}

async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) { const i = next++; results[i] = await jobs[i]!(); }
  }));
  return results;
}

// ---- gather runs ---------------------------------------------------------

function pinned(seed: string) {
  const day = schedule.days.find((d: { seed: string }) => d.seed === seed);
  return index.pinSeed(seed, day?.rhymeKey);
}

const jobs: (() => Promise<void>)[] = [];
for (const seed of seedList) {
  const ctx = startSession(index, pinned(seed), config);
  for (const { model, n } of runs) {
    for (let r = 0; r < n; r++) {
      const path = resolve(cacheDir, `${seed}.${model}.${r}.json`);
      if (existsSync(path)) continue;
      jobs.push(async () => {
        const rec = await callModel(model, prompt(seed, ctx.puzzle.seedRespelling));
        writeFileSync(path, JSON.stringify(rec, null, 1));
        process.stderr.write(`  ran ${seed} ${model} #${r}: ${rec.words.length} words, ${(rec.durationMs / 1000).toFixed(0)}s\n`);
      });
    }
  }
}
if (jobs.length) {
  process.stderr.write(`Calling the model ${jobs.length} times...\n`);
  await pool(jobs, 4);
}

// ---- report --------------------------------------------------------------

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const LAUREATE = 70;
const summary: Record<string, { pcts: number[]; laureate: number; words: number[]; cost: number[]; ms: number[]; jaccard: number[] }> = {};

for (const seed of seedList) {
  const ctx = startSession(index, pinned(seed), config);
  const day = schedule.days.find((d: { seed: string }) => d.seed === seed);
  console.log(`\n## ${seed} /${ctx.seed.rhymeKey}/  ${ctx.puzzle.answers.length} Answers, max ${ctx.maxScore}` +
    (day ? `, Difficulty ${day.difficulty} (${day.weekday})` : ""));

  const produced = new Map<string, Set<string>>(); // word -> run labels that produced it
  const rejected = new Map<string, string>(); // word -> reason + detail
  const accepted = new Map<string, string>(); // word -> tier

  for (const { model, n } of runs) {
    const sets: Set<string>[] = [];
    for (let r = 0; r < n; r++) {
      const rec: RunRecord = JSON.parse(readFileSync(resolve(cacheDir, `${seed}.${model}.${r}.json`), "utf8"));
      let state = emptyPlayState;
      const tally: Record<string, number> = {};
      const set = new Set<string>();
      for (const w of rec.words) {
        set.add(w);
        if (!produced.has(w)) produced.set(w, new Set());
        produced.get(w)!.add(`${model}#${r}`);
        const { state: next, result } = applySubmission(ctx, state, w);
        state = next;
        if (!result) continue;
        const v = result.verdict;
        const k = v.outcome === "rejected" ? v.reason : v.outcome;
        tally[k] = (tally[k] ?? 0) + 1;
        if (v.outcome === "rejected") {
          if (v.reason === "already-submitted" || v.reason === "is-the-seed-word") continue;
          const detail = v.reason === "not-a-known-word"
            ? (wordList.has(w) ? "on word list, no reading" : "not on word list")
            : v.respelling ?? "";
          rejected.set(w, `${v.reason}${detail ? ` (${detail})` : ""}`);
        } else accepted.set(w, v.outcome);
      }
      sets.push(set);
      const share = score(ctx, state) / ctx.maxScore;
      const s = (summary[model] ??= { pcts: [], laureate: 0, words: [], cost: [], ms: [], jaccard: [] });
      s.pcts.push(share); s.words.push(rec.words.length); s.ms.push(rec.durationMs);
      if (rec.costUsd != null) s.cost.push(rec.costUsd);
      if (100 * share >= LAUREATE) s.laureate++;
      console.log(`  ${model}#${r}: ${rec.words.length} words -> ${pct(share)} ${rank(ctx, state).label.padEnd(13)} ` +
        Object.entries(tally).map(([k, c]) => `${k} ${c}`).join(", "));
    }
    for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) {
      const A = sets[a]!, B = sets[b]!;
      const inter = [...A].filter((w) => B.has(w)).length;
      summary[model]!.jaccard.push(inter / (A.size + B.size - inter));
    }
  }

  const byReason = new Map<string, string[]>();
  for (const [w, why] of rejected) {
    const key = why.replace(/ \(.*/, "");
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key)!.push(`${w}${why.includes("(") ? " " + why.slice(why.indexOf("(")) : ""} x${produced.get(w)!.size}`);
  }
  for (const [reason, ws] of byReason) console.log(`  REJECTED ${reason}: ${ws.join("; ")}`);
  const bonus = [...accepted].filter(([, t]) => t === "bonus").map(([w]) => w);
  if (bonus.length) console.log(`  BONUS: ${bonus.join(", ")}`);

  const real = appeals.filter((a) => a.seedWord === seed && a.seedRhymeKey === ctx.seed.rhymeKey);
  if (real.length) {
    const words = [...new Set(real.map((a) => a.word))];
    const hit = words.filter((w) => produced.has(w));
    console.log(`  REAL APPEALS (${words.length}), synthetic produced ${hit.length}: ` +
      words.map((w) => (produced.has(w) ? `*${w}*` : w)).join(", "));
  }

  const missed = ctx.puzzle.answers.filter((a) => !produced.has(a.word))
    .sort((a, b) => (b.knownness ?? 0) - (a.knownness ?? 0));
  console.log(`  NEVER PRODUCED (${missed.length}/${ctx.puzzle.answers.length}, most known first): ` +
    missed.slice(0, 20).map((a) => `${a.word} ${(a.knownness ?? 0).toFixed(2)}`).join(", "));
}

console.log(`\n## Summary`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
for (const [model, s] of Object.entries(summary)) {
  const sorted = [...s.pcts].sort((a, b) => a - b);
  console.log(`  ${model}: ${s.pcts.length} runs, Rank% mean ${pct(mean(s.pcts))} (median ${pct(sorted[sorted.length >> 1]!)}, ` +
    `min ${pct(sorted[0]!)}, max ${pct(sorted[sorted.length - 1]!)}), Laureate on ${s.laureate}/${s.pcts.length}, ` +
    `${mean(s.words).toFixed(0)} words/run, run-to-run Jaccard ${mean(s.jaccard).toFixed(2)}, ` +
    `${(mean(s.ms) / 1000).toFixed(0)}s/run` + (s.cost.length ? `, $${mean(s.cost).toFixed(4)}/run (API-equivalent)` : ""));
}
