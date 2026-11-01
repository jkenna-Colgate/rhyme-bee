import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callModel,
  clearUsageStop,
  describeUsageStop,
  flagUsageStop,
  inParallel,
  parseClaudeStream,
  replyFailure,
  USAGE_STOP_AT,
  usageStopOf,
  usageStopped,
  UsageStopError,
  type ClaudeOutput,
} from "../modelCall.ts";

// The lines a real `claude -p --output-format stream-json --verbose` call printed (#286), trimmed.
const INIT = JSON.stringify({ type: "system", subtype: "init", session_id: "s" });
const ASSISTANT = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } });
function rateLimit(fiveHour: number | undefined, sevenDay: number | undefined, status = "allowed"): string {
  const unifiedWindows: Record<string, unknown> = {};
  if (fiveHour !== undefined) unifiedWindows.five_hour = { utilization: fiveHour, resetsAt: 1793563200, status };
  if (sevenDay !== undefined) unifiedWindows.seven_day = { utilization: sevenDay, resetsAt: 1793923200, status: "allowed" };
  return JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: { status, resetsAt: 1793563200, rateLimitType: "five_hour", overageStatus: "rejected", isUsingOverage: false, unifiedWindows },
  });
}
function result(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result", subtype: "success", is_error: false, api_error_status: null, result: "ok", total_cost_usd: 0.0023,
    modelUsage: { "claude-haiku-5-5": { inputTokens: 2, outputTokens: 4 } }, ...over,
  });
}
const stream = (...lines: string[]) => `${lines.join("\n")}\n`;

describe("parseClaudeStream", () => {
  it("reads the result line and the usage windows", () => {
    const s = parseClaudeStream(stream(INIT, ASSISTANT, rateLimit(0.43, 0.14), result()));
    expect(s).toMatchObject({ result: "ok", isError: false, subtype: "success", apiErrorStatus: null, costUsd: 0.0023, answeredBy: ["claude-haiku-5-5"] });
    expect(s.usage?.windows.five_hour).toEqual({ utilization: 0.43, resetsAt: 1793563200, status: "allowed" });
    expect(s.usage?.windows.seven_day?.utilization).toBe(0.14);
  });

  it("reads an error reply as one", () => {
    const s = parseClaudeStream(stream(result({ is_error: true, subtype: "success", api_error_status: 429, result: "Claude AI usage limit reached" })));
    expect(s).toMatchObject({ isError: true, apiErrorStatus: 429, result: "Claude AI usage limit reached" });
  });

  it("has no usage reading without a rate_limit_event", () => {
    expect(parseClaudeStream(stream(INIT, result())).usage).toBeNull();
  });

  it("has no result without a result line, and skips lines that are not JSON", () => {
    const s = parseClaudeStream(stream("Warning: something", INIT, "{not json"));
    expect(s.result).toBeNull();
  });

  it("reads a missing utilization as unknown", () => {
    const line = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { resetsAt: 1 } } } });
    const s = parseClaudeStream(stream(line, result()));
    expect(s.usage?.windows.five_hour?.utilization).toBeNull();
    expect(s.usage?.windows.seven_day).toBeUndefined();
  });

  it("takes the latest of several usage events", () => {
    const s = parseClaudeStream(stream(rateLimit(0.5, 0.1), ASSISTANT, rateLimit(0.93, 0.2), result()));
    expect(s.usage?.windows.five_hour?.utilization).toBe(0.93);
  });

  it("tolerates CRLF line ends", () => {
    expect(parseClaudeStream([rateLimit(0.2, 0.1), result()].join("\r\n")).result).toBe("ok");
  });
});

describe("replyFailure", () => {
  it("is null for a success", () => {
    expect(replyFailure(0, parseClaudeStream(stream(result())))).toBeNull();
  });

  it("says the api_error_status and the result text of an error reply", () => {
    const failure = replyFailure(0, parseClaudeStream(stream(result({ is_error: true, api_error_status: 429, result: "You've hit your limit" }))));
    expect(failure).toContain("api_error_status 429");
    expect(failure).toContain("You've hit your limit");
  });

  it("fails a subtype other than success, a non-zero exit, and no result line", () => {
    expect(replyFailure(0, parseClaudeStream(stream(result({ subtype: "error_max_turns" }))))).toContain("error_max_turns");
    expect(replyFailure(1, parseClaudeStream(stream(result())), "boom")).toContain("claude exited 1");
    expect(replyFailure(0, parseClaudeStream(stream(INIT)))).toContain("no result");
  });
});

describe("usageStopOf", () => {
  const of = (...lines: string[]) => parseClaudeStream(stream(...lines));

  it("stops at the threshold on either window, and not below it", () => {
    expect(USAGE_STOP_AT).toBe(0.9);
    expect(usageStopOf(of(rateLimit(0.89, 0.5), result()), false)).toBeNull();
    expect(usageStopOf(of(rateLimit(0.9, 0.5), result()), false)).toMatchObject({ window: "five_hour", utilization: 0.9, limitReached: false });
    expect(usageStopOf(of(rateLimit(0.2, 0.95), result()), false)).toMatchObject({ window: "seven_day", utilization: 0.95 });
  });

  it("names the window that resets later when both are over", () => {
    expect(usageStopOf(of(rateLimit(0.95, 0.92), result()), false)?.window).toBe("seven_day");
  });

  it("does not stop on an unknown utilization or a missing usage event", () => {
    const line = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
    expect(usageStopOf(of(line, result()), false)).toBeNull();
    expect(usageStopOf(of(result()), false)).toBeNull();
  });

  it("stops on a call refused for the limit", () => {
    expect(usageStopOf(of(rateLimit(1, 0.3, "rejected"), result({ is_error: true })), true)).toMatchObject({ limitReached: true, window: "five_hour" });
    expect(usageStopOf(of(result({ is_error: true, api_error_status: 429, result: "Too many requests" })), true)?.limitReached).toBe(true);
    expect(usageStopOf(of(result({ is_error: true, result: "Claude AI usage limit reached|1793563200" })), true)?.limitReached).toBe(true);
  });

  it("does not take an ordinary error for the limit", () => {
    expect(usageStopOf(of(rateLimit(0.3, 0.1), result({ is_error: true, api_error_status: 500, result: "Overloaded" })), true)).toBeNull();
  });

  it("says which window and when it resets", () => {
    const now = new Date(1793563200 * 1000 - 3600_000);
    const said = describeUsageStop({ window: "five_hour", utilization: 0.913, resetsAt: 1793563200, limitReached: false }, now);
    expect(said).toMatch(/^the five-hour usage window is at 91% \(resets \d\d:\d\d local\)$/);
    expect(describeUsageStop({ window: null, utilization: null, resetsAt: null, limitReached: true })).toBe("the usage limit was reached");
  });
});

describe("callModel", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "model-cache-"));
    clearUsageStop();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearUsageStop();
  });
  const cli = (stdout: string, code = 0) => {
    const calls: string[] = [];
    return { calls, claude: async (_m: string, prompt: string): Promise<ClaudeOutput> => (calls.push(prompt), { code, stdout, stderr: "" }) };
  };

  it("caches a success and reads it back", async () => {
    const io = cli(stream(rateLimit(0.2, 0.1), result({ result: "cat, hat" })));
    const first = await callModel("claude-haiku-5-5", "p", 1, undefined, { ...io, cacheDir: dir });
    const again = await callModel("claude-haiku-5-5", "p", 1, undefined, { ...io, cacheDir: dir });
    expect(first).toMatchObject({ text: "cat, hat", cached: false, answeredBy: ["claude-haiku-5-5"] });
    expect(again).toMatchObject({ text: "cat, hat", cached: true });
    expect(io.calls).toHaveLength(1);
  });

  it("never caches an error reply", async () => {
    const io = cli(stream(result({ is_error: true, api_error_status: 500, result: "Overloaded" })));
    await expect(callModel("claude-haiku-5-5", "p", 1, undefined, { ...io, cacheDir: dir })).rejects.toThrow(/api_error_status 500.*Overloaded/);
    expect(readdirSync(dir)).toEqual([]);
    expect(usageStopped()).toBeNull();
  });

  it("rejects a usage-limit reply as a usage stop, uncached", async () => {
    const io = cli(stream(result({ is_error: true, result: "Claude AI usage limit reached" })));
    await expect(callModel("claude-haiku-5-5", "p", 1, undefined, { ...io, cacheDir: dir })).rejects.toBeInstanceOf(UsageStopError);
    expect(readdirSync(dir)).toEqual([]);
    expect(usageStopped()?.limitReached).toBe(true);
  });

  it("keeps a reply that crosses the threshold, then starts no new call but still serves the cache", async () => {
    const io = cli(stream(rateLimit(0.91, 0.1), result({ result: "late" })));
    const crossing = await callModel("claude-haiku-5-5", "a", 1, undefined, { ...io, cacheDir: dir });
    expect(crossing).toMatchObject({ text: "late", cached: false });
    expect(existsSync(dir) && readdirSync(dir)).toHaveLength(1);
    expect(usageStopped()).toMatchObject({ window: "five_hour", utilization: 0.91 });
    await expect(callModel("claude-haiku-5-5", "b", 1, undefined, { ...io, cacheDir: dir })).rejects.toBeInstanceOf(UsageStopError);
    expect(io.calls).toEqual(["a"]);
    expect(await callModel("claude-haiku-5-5", "a", 1, undefined, { ...io, cacheDir: dir })).toMatchObject({ cached: true });
  });
});

describe("inParallel", () => {
  beforeEach(clearUsageStop);
  afterEach(clearUsageStop);

  /** A job that resolves when its gate is opened, recording that it started and finished. */
  function gated(log: string[], name: string) {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    return { open, job: async () => { log.push(`start ${name}`); await gate; log.push(`end ${name}`); return name; } };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("runs every job and keeps their order", async () => {
    expect(await inParallel([1, 2, 3, 4, 5].map((n) => async () => n * 10), 2)).toEqual([10, 20, 30, 40, 50]);
  });

  it("stops pulling new jobs once the stop is flagged, and waits for the ones in flight", async () => {
    const log: string[] = [];
    const jobs = ["a", "b", "c", "d"].map((n) => gated(log, n));
    const running = inParallel(jobs.map((j) => j.job), 2);
    const settled = running.then(() => "resolved", (e) => e);
    await tick();
    expect(log).toEqual(["start a", "start b"]);
    flagUsageStop({ window: "five_hour", utilization: 0.92, resetsAt: null, limitReached: false });
    jobs[0]!.open();
    await tick();
    expect(log).toEqual(["start a", "start b", "end a"]);
    let done = false;
    void settled.then(() => (done = true));
    await tick();
    expect(done).toBe(false); // b is still in flight
    jobs[1]!.open();
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(UsageStopError);
    expect(log).toEqual(["start a", "start b", "end a", "end b"]);
  });

  it("returns normally when the stop comes with the last job", async () => {
    const out = await inParallel([async () => 1, async () => {
      flagUsageStop({ window: "seven_day", utilization: 0.95, resetsAt: null, limitReached: false });
      return 2;
    }], 1);
    expect(out).toEqual([1, 2]);
  });

  it("on a failed job, waits for the others in flight and starts no more", async () => {
    const log: string[] = [];
    const slow = gated(log, "slow");
    const later = gated(log, "later");
    const running = inParallel([slow.job, async () => { throw new Error("boom"); }, later.job], 2).catch((e: Error) => e.message);
    await tick();
    slow.open();
    expect(await running).toBe("boom");
    expect(log).toEqual(["start slow", "end slow"]);
  });
});
