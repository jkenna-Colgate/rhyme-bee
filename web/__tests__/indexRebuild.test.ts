/**
 * The rebuild-and-forget pairing: **a rebuild always drops the loaded index.**
 *
 * ADR-0016 chose rebuild-on-write with no preview mode so that every figure the
 * Editor's Pass shows comes off the real artifact. The whole of that rests on
 * one call, `cache.forget()`, on the one settle path `done()` — and a rebuild
 * that skipped it is the failure this route is least likely to notice, because
 * a superseded index answers every question plausibly. The four cases below are
 * the four ways a rebuild can end, which is what `makeRebuild`'s own comment
 * claims: forgotten on *every* outcome, success or failure.
 *
 * The build is faked. `scripts/build-index.ts` resolves its directories from its
 * own file location and ignores cwd, so a temp root would either fail or rebuild
 * the repository's real fifteen-megabyte artifact; no test here spawns it. What
 * that leaves uncovered is stated and accepted: nothing below proves `shell:
 * true`, the argv, or that `npm` is findable from the given cwd.
 *
 * The timeout is reached by injecting a short one rather than by advancing a
 * clock. This suite has no fake timers anywhere, and five real minutes cannot be
 * waited out. The kill is injected for a sharper reason: `killTree` runs a real
 * `taskkill /pid <n> /f /t` on win32, which is the maintainer's platform, so a
 * test that let the real one through would fire a real kill at a fabricated pid.
 */

import { EventEmitter } from "node:events";
import type { ChildProcess, ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import type { IndexCache } from "../builtIndex.ts";
import { makeRebuild } from "../indexRebuild.ts";

/**
 * A child process that goes nowhere until the test says so. Both streams are
 * real emitters because the module subscribes to both — a build failure
 * announces itself on stderr and the line naming the bad input is often the
 * last thing on stdout, and the two are merged before `tail` sees them.
 *
 * `kill` records rather than doing anything, so the timeout case can assert the
 * module reached for the injected `killTree` and not for this.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 4242;
  ownKillCalls = 0;

  kill(): boolean {
    this.ownKillCalls += 1;
    return true;
  }
}

/** How long the faked build gets. Long enough not to fire on the other cases. */
const NEVER = 60_000;

function harness(timeoutMs = NEVER) {
  const child = new FakeChild();
  const spawnArgs: unknown[][] = [];
  const killed: ChildProcess[] = [];
  let forgets = 0;

  const cache: IndexCache = {
    // Neither is reached by a rebuild, and saying so out loud is cheaper than a
    // stub index that would quietly absorb it if one day it were.
    index: (): RhymeIndex => {
      throw new Error("a rebuild does not read the index");
    },
    knownnessThreshold: (): number => {
      throw new Error("a rebuild does not read the threshold");
    },
    forget: () => {
      forgets += 1;
    },
  };

  const rebuild = makeRebuild({
    cache,
    spawn: ((...args: unknown[]) => {
      spawnArgs.push(args);
      return child as unknown as ChildProcessWithoutNullStreams;
    }) as unknown as typeof spawn,
    kill: (target) => killed.push(target),
    timeoutMs,
  });

  return { child, rebuild, spawnArgs, killed, forgets: () => forgets };
}

describe("makeRebuild", () => {
  it("forgets the loaded index when the build exits 0", async () => {
    const { child, rebuild, spawnArgs, forgets } = harness();
    const running = rebuild("/tmp/some-root");
    child.emit("close", 0);

    expect(await running).toEqual({ ok: true });
    expect(forgets()).toBe(1);
    // The `root` the factory's returned function takes is the build's cwd.
    expect(spawnArgs[0]?.[2]).toMatchObject({ cwd: "/tmp/some-root" });
  });

  it("forgets the loaded index when the build exits non-zero", async () => {
    const { child, rebuild, forgets } = harness();
    const running = rebuild("/tmp/some-root");
    child.stderr.emit("data", "cmudict.dict:41: unparseable");
    child.emit("close", 2);

    // Not "the previous artifact is still standing, so the copy is fine":
    // `scripts/build-index.ts` calls `writeIndexArtifact` before it prints the
    // counts it ends on, so a non-zero exit can follow a completed write.
    expect(await running).toEqual({
      ok: false,
      error: "npm run build:index exited 2.\ncmudict.dict:41: unparseable",
    });
    expect(forgets()).toBe(1);
  });

  it("forgets the loaded index when the spawn itself errors", async () => {
    const { child, rebuild, forgets } = harness();
    const running = rebuild("/tmp/some-root");
    child.emit("error", new Error("spawn npm ENOENT"));

    expect(await running).toEqual({ ok: false, error: "spawn npm ENOENT" });
    expect(forgets()).toBe(1);
  });

  it("forgets the loaded index when the build is abandoned on the timeout", async () => {
    const { rebuild, forgets } = harness(1);
    const result = await rebuild("/tmp/some-root");

    // The one path where the artifact on disk afterwards is genuinely unknown —
    // the previous one, the new one, or a partial file, because the kill races
    // the write. Holding the copy would be guessing which.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("did not finish within");
    expect(forgets()).toBe(1);
  });

  it("abandons the build with the injected kill, not the child's own", async () => {
    const { child, rebuild, killed } = harness(1);
    await rebuild("/tmp/some-root");

    // `shell: true` means the child held is the shell, so a bare `child.kill()`
    // would leave `npm` and the build under it running — writing and sweeping
    // the artifact long after the route reported the rebuild abandoned.
    expect(killed).toEqual([child]);
    expect(child.ownKillCalls).toBe(0);
  });

  it("settles once and forgets once when a close arrives after the timeout", async () => {
    const { child, rebuild, forgets } = harness(1);
    const running = rebuild("/tmp/some-root");
    const timedOut = await running;

    // The killed build's shell exits, and `close` fires on a promise that has
    // already answered. A second `forget` would be harmless; a second `settle`
    // reporting success after the editor was told the rebuild was abandoned
    // would not be.
    child.emit("close", 0);

    // Nothing useful can be asserted about awaiting `running` a second time —
    // a promise hands back the value it settled with whether or not `done()`
    // guards. That the timeout won the race is `timedOut.ok`, and that the late
    // `close` did not run the settle path again is the single `forget`.
    expect(timedOut.ok).toBe(false);
    expect(forgets()).toBe(1);
  });

  it("names the exit code and carries the last twenty lines of the output", async () => {
    const { child, rebuild } = harness();
    const running = rebuild("/tmp/some-root");
    // Split across the streams, because the module merges them: the last lines
    // of a real failure are usually stderr's, over stdout's progress.
    child.stdout.emit("data", numbered(1, 25));
    child.stderr.emit("data", `\n${numbered(26, 30)}`);
    child.emit("close", 1);

    const result = await running;
    expect(result.ok).toBe(false);
    const lines = (result.ok === false ? result.error : "").split("\n");
    expect(lines[0]).toBe("npm run build:index exited 1.");
    // Bounded because this reaches a browser: the last twenty, and nothing of
    // the 370,000-word input's worth of output before them.
    expect(lines.slice(1)).toEqual(numbered(11, 30).split("\n"));
  });
});

/** `line-first` … `line-last`, one per line and no trailing newline. */
function numbered(first: number, last: number): string {
  const lines: string[] = [];
  for (let n = first; n <= last; n += 1) lines.push(`line-${n}`);
  return lines.join("\n");
}
