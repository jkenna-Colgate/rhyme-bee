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
 *
 * Only a reply the CLI calls a success is cached (#286). A non-zero exit, a
 * result line marked `is_error` or with a subtype other than `success`, or no
 * result line at all rejects, and nothing is written: a usage-limit message
 * cached as a reply would be read back as the model's words on every resume.
 *
 * **The usage limit** (#286). The CLI is run with `--output-format stream-json
 * --verbose`, whose stream reports how much of the five-hour and seven-day
 * usage windows the subscription has spent. Once a reply puts either window at
 * `USAGE_STOP_AT` or over, or a call is refused for the limit, the usage stop is
 * flagged and no new uncached call starts: `callModel` rejects with a
 * `UsageStopError`, and `inParallel` hands out no more jobs, lets the calls in
 * flight finish (each is cached, so nothing paid for is lost) and only then
 * rejects. A cached call is still served, since it costs nothing. To resume,
 * the caller writes nothing that consumes the run number, which is to say no
 * run report, and the same command is run again after the reset: it gets the
 * same run number, and every call that finished replays from the cache.
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

// ---- the usage limit -----------------------------------------------------------

/** The share of either usage window at which no new call starts (#286). */
export const USAGE_STOP_AT = 0.9;

export type UsageWindowName = "five_hour" | "seven_day";
const WINDOWS: readonly UsageWindowName[] = ["five_hour", "seven_day"];

/** One usage window as the CLI last reported it. A null is a figure it did not give, which is unknown and never a stop. */
export interface UsageWindow {
  utilization: number | null;
  /** Unix seconds. */
  resetsAt: number | null;
  status: string | null;
}

/** The latest `rate_limit_event` in a call's stream. */
export interface UsageReading {
  status: string | null;
  /** The window the event is about, as `rateLimitType`. */
  type: string | null;
  resetsAt: number | null;
  windows: Partial<Record<UsageWindowName, UsageWindow>>;
}

/** What one `claude -p --output-format stream-json --verbose` call printed. */
export interface ClaudeStream {
  /** The result line's text, or null when the stream has no result line. */
  result: string | null;
  isError: boolean;
  subtype: string | null;
  apiErrorStatus: number | string | null;
  costUsd: number | null;
  /** The models the CLI says answered, from its usage report. */
  answeredBy: string[];
  usage: UsageReading | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

function usageOf(info: Record<string, unknown>): UsageReading {
  const windows: UsageReading["windows"] = {};
  const unified = info.unifiedWindows;
  if (unified && typeof unified === "object") {
    for (const name of WINDOWS) {
      const w = (unified as Record<string, unknown>)[name];
      if (w && typeof w === "object") {
        const o = w as Record<string, unknown>;
        windows[name] = { utilization: num(o.utilization), resetsAt: num(o.resetsAt), status: str(o.status) };
      }
    }
  }
  return { status: str(info.status), type: str(info.rateLimitType), resetsAt: num(info.resetsAt), windows };
}

/** Read a call's stream, line by line, tolerating lines that are not JSON and fields that are missing. A later usage event replaces an earlier one. */
export function parseClaudeStream(stdout: string): ClaudeStream {
  const out: ClaudeStream = { result: null, isError: false, subtype: null, apiErrorStatus: null, costUsd: null, answeredBy: [], usage: null };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "rate_limit_event" && event.rate_limit_info && typeof event.rate_limit_info === "object") {
      out.usage = usageOf(event.rate_limit_info as Record<string, unknown>);
    } else if (event.type === "result") {
      out.result = str(event.result) ?? "";
      out.isError = event.is_error === true;
      out.subtype = str(event.subtype);
      out.apiErrorStatus = typeof event.api_error_status === "number" || typeof event.api_error_status === "string" ? event.api_error_status : null;
      out.costUsd = num(event.total_cost_usd);
      out.answeredBy = event.modelUsage && typeof event.modelUsage === "object" ? Object.keys(event.modelUsage) : [];
    }
  }
  return out;
}

/** Why a call failed, legibly, or null when it is a reply to cache. */
export function replyFailure(code: number | null, stream: ClaudeStream, stderr = ""): string | null {
  const said = [
    stream.apiErrorStatus !== null ? `api_error_status ${stream.apiErrorStatus}` : null,
    stream.result ? `"${stream.result.trim().slice(0, 300)}"` : null,
    stderr.trim() ? stderr.trim().slice(0, 300) : null,
  ].filter(Boolean).join(": ");
  if (code !== 0) return `claude exited ${code}${said ? `: ${said}` : ""}`;
  if (stream.result === null) return `claude printed no result${said ? `: ${said}` : ""}`;
  if (stream.isError || (stream.subtype !== null && stream.subtype !== "success")) {
    return `claude replied with an error (${stream.subtype ?? "no subtype"})${said ? `: ${said}` : ""}`;
  }
  return null;
}

/** Why no new call should start: a window at the threshold or over, or the limit itself reached. */
export interface UsageStop {
  window: UsageWindowName | null;
  utilization: number | null;
  /** Unix seconds. */
  resetsAt: number | null;
  /** The limit refused a call, rather than a window passing the threshold. */
  limitReached: boolean;
}

const LIMIT_TEXT = /usage limit|rate limit|hit your limit|limit reached/i;

/**
 * Whether this call's stream stops the run (#286). It stops on a window at
 * `threshold` or over, or on a call refused for the limit: a usage event whose
 * status is `rejected`, or, on a failed call, a 429 or a result that says so.
 * A missing window or utilization is unknown, and never a stop.
 */
export function usageStopOf(stream: ClaudeStream, failed: boolean, threshold = USAGE_STOP_AT): UsageStop | null {
  const usage = stream.usage;
  const windows = WINDOWS.flatMap((name) => (usage?.windows[name] ? [{ name, ...usage.windows[name]! }] : []));
  const rejected = windows.find((w) => w.status === "rejected");
  const limitReached =
    usage?.status === "rejected" ||
    rejected !== undefined ||
    (failed && (String(stream.apiErrorStatus) === "429" || LIMIT_TEXT.test(stream.result ?? "")));
  if (limitReached) {
    const named = rejected ?? windows.find((w) => w.name === usage?.type);
    return {
      window: named?.name ?? null,
      utilization: named?.utilization ?? null,
      resetsAt: named?.resetsAt ?? usage?.resetsAt ?? null,
      limitReached: true,
    };
  }
  const over = windows.filter((w) => w.utilization !== null && w.utilization >= threshold);
  if (over.length === 0) return null;
  // Of two windows over, the one that resets later is the one to wait for.
  const last = over.reduce((a, b) => ((b.resetsAt ?? 0) > (a.resetsAt ?? 0) ? b : a));
  return { window: last.name, utilization: last.utilization, resetsAt: last.resetsAt, limitReached: false };
}

const windowName = (w: UsageWindowName) => (w === "five_hour" ? "five-hour" : "seven-day");

/** When a window resets, in the maintainer's local time: the time alone today, the day as well after. */
function resetTime(resetsAt: number, now: Date): string {
  const at = new Date(resetsAt * 1000);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

/** "the five-hour usage window is at 91% (resets 18:00 local)" */
export function describeUsageStop(stop: UsageStop, now = new Date()): string {
  const resets = stop.resetsAt !== null ? ` (resets ${resetTime(stop.resetsAt, now)} local)` : "";
  const window = stop.window ? `${windowName(stop.window)} usage window` : "usage window";
  if (stop.limitReached) return `the ${stop.window ? `${windowName(stop.window)} ` : ""}usage limit was reached${resets}`;
  return `the ${window} is at ${Math.round((stop.utilization ?? 0) * 100)}%${resets}`;
}

/** No new call starts past the usage stop. `stop` says which window and when it resets. */
export class UsageStopError extends Error {
  constructor(readonly stop: UsageStop, detail?: string) {
    super(`Stopped at the usage limit: ${describeUsageStop(stop)}${detail ? ` (${detail})` : ""}`);
    this.name = "UsageStopError";
  }
}

let stopped: UsageStop | null = null;

/** The usage stop, once any call has flagged it in this process. */
export function usageStopped(): UsageStop | null {
  return stopped;
}

/** Flag the usage stop. Of two, the one that resets later is kept, since that is when the run can resume. */
export function flagUsageStop(stop: UsageStop): void {
  if (!stopped || (stop.resetsAt ?? 0) > (stopped.resetsAt ?? 0)) stopped = stop;
}

/** For tests: forget the usage stop. */
export function clearUsageStop(): void {
  stopped = null;
}

// ---- the call ------------------------------------------------------------------

export interface ModelReply {
  text: string;
  /** The models the CLI says answered, from its usage report. */
  answeredBy: string[];
  costUsd: number | null;
  cached: boolean;
}

/** What the CLI printed, and how it exited. */
export interface ClaudeOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The seams a test replaces: the CLI itself, and where the cache is kept. */
export interface CallIo {
  claude?: (model: string, prompt: string) => Promise<ClaudeOutput>;
  cacheDir?: string;
}

function spawnClaude(model: string, prompt: string): Promise<ClaudeOutput> {
  return new Promise((done, fail) => {
    // Run outside the repo so the model never loads CLAUDE.md, the glossary or the answer data.
    const child = spawn("claude", ["-p", "--model", model, "--output-format", "stream-json", "--verbose"], { shell: true, cwd: tmpdir() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(prompt);
  });
}

/**
 * Call the model once, or read the call back from the cache. A `label` tells
 * apart calls one run makes with the same prompt on purpose, as a Batch's looks
 * at one Seed Word do: without it the second look would read back the first.
 * Past the usage stop an uncached call rejects without being made.
 */
export async function callModel(model: string, prompt: string, run: number, label?: string, io: CallIo = {}): Promise<ModelReply> {
  const dir = io.cacheDir ?? cacheDir;
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${model}.${createHash("sha1").update(prompt).digest("hex").slice(0, 16)}.run-${run}${label ? `.${label}` : ""}.json`);
  if (existsSync(path)) {
    const hit = JSON.parse(readFileSync(path, "utf8"));
    return { text: hit.result, answeredBy: hit.answeredBy, costUsd: hit.costUsd, cached: true };
  }
  if (stopped) throw new UsageStopError(stopped);
  const out = await (io.claude ?? spawnClaude)(model, prompt);
  const stream = parseClaudeStream(out.stdout);
  const failure = replyFailure(out.code, stream, out.stderr);
  const stop = usageStopOf(stream, failure !== null);
  if (stop) flagUsageStop(stop);
  if (failure) throw stop?.limitReached ? new UsageStopError(stop, failure) : new Error(failure);
  const reply = { result: stream.result!, answeredBy: stream.answeredBy, costUsd: stream.costUsd };
  writeFileSync(path, JSON.stringify({ model, run, prompt, ...reply }, null, 1));
  return { text: reply.result, answeredBy: reply.answeredBy, costUsd: reply.costUsd, cached: false };
}

/**
 * Run jobs a few at a time, keeping their order. A job that fails, or the usage
 * stop, ends the handing out of jobs; the jobs in flight are waited for, so no
 * paid call is cut off half done, and then the run rejects.
 */
export async function inParallel<T>(jobs: (() => Promise<T>)[], width = 4): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const failed: { error?: unknown; yes: boolean } = { yes: false };
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length && !failed.yes && !stopped) {
      const i = next++;
      try {
        results[i] = await jobs[i]!();
        process.stderr.write(".");
      } catch (error) {
        if (!failed.yes) Object.assign(failed, { error, yes: true });
      }
    }
  }));
  if (failed.yes) throw failed.error;
  if (next < jobs.length) throw new UsageStopError(stopped!);
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
