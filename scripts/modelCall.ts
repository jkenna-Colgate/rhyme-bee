/**
 * The one way the Judge and the Synthetic Player call a model (#250): the
 * `claude` CLI in headless print mode on the maintainer's subscription, with an
 * exact model id and never an alias, so every run report can say which model
 * answered.
 *
 * Raw output is cached in `.model-cache/` (gitignored), keyed by model, prompt
 * and run number. The run number comes from the run reports already committed,
 * so the cache only resumes an interrupted run and never answers a deliberate
 * re-run: a finished run has a report, and the next one gets the next number.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = resolve(root, ".model-cache");
export const runsDir = resolve(root, "data/judge-runs");

/** An exact model id (`claude-sonnet-5-5`), never an alias (`sonnet`), which would answer with a model nobody measured. */
export function exactModelId(id: string): string {
  if (!/^claude-[a-z]+-\d+(-\d+)*$/.test(id)) throw new Error(`"${id}" is not an exact model id; give one like claude-sonnet-5-5, never an alias`);
  return id;
}

/** The number of the run a report with this stem would be: one more than the reports already committed. */
export function nextRun(stem: string): number {
  if (!existsSync(runsDir)) return 1;
  const done = readdirSync(runsDir).filter((f) => f.includes(`.${stem}.run-`));
  return done.length + 1;
}

export interface ModelReply {
  text: string;
  /** The models the CLI says answered, from its usage report. */
  answeredBy: string[];
  costUsd: number | null;
  cached: boolean;
}

/** Call the model once, or read the call back from the cache. */
export function callModel(model: string, prompt: string, run: number): Promise<ModelReply> {
  mkdirSync(cacheDir, { recursive: true });
  const path = resolve(cacheDir, `${model}.${createHash("sha1").update(prompt).digest("hex").slice(0, 16)}.run-${run}.json`);
  if (existsSync(path)) {
    const hit = JSON.parse(readFileSync(path, "utf8"));
    return Promise.resolve({ text: hit.result, answeredBy: hit.answeredBy, costUsd: hit.costUsd, cached: true });
  }
  return new Promise((done, fail) => {
    // Run outside the repo so the model never loads CLAUDE.md, the glossary or the answer data.
    const child = spawn("claude", ["-p", "--model", model, "--output-format", "json"], { shell: true, cwd: tmpdir() });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error(`claude exited ${code}: ${err}`));
      let json: { result?: string; total_cost_usd?: number; modelUsage?: Record<string, unknown> };
      try {
        json = JSON.parse(out);
      } catch {
        return fail(new Error(`claude printed something that is not JSON: ${out.slice(0, 200)}`));
      }
      const reply = { result: json.result ?? "", answeredBy: Object.keys(json.modelUsage ?? {}), costUsd: json.total_cost_usd ?? null };
      writeFileSync(path, JSON.stringify({ model, run, prompt, ...reply }, null, 1));
      done({ text: reply.result, answeredBy: reply.answeredBy, costUsd: reply.costUsd, cached: false });
    });
    child.stdin.end(prompt);
  });
}

/** Run jobs a few at a time, keeping their order. */
export async function inParallel<T>(jobs: (() => Promise<T>)[], width = 4): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]!();
      process.stderr.write(".");
    }
  }));
  return results;
}

/** Commit-ready: write a run report to `data/judge-runs/`, named for its date, stem and run number. */
export function writeRunReport(date: string, stem: string, run: number, report: unknown): string {
  mkdirSync(runsDir, { recursive: true });
  const path = resolve(runsDir, `${date}.${stem}.run-${run}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/** Today's date where the maintainer is, as a run report is dated. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
