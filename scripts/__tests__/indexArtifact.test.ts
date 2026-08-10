/**
 * The staleness predicate: does this deploy need the four-minute Rhyme Index
 * rebuild, or only the bundle?
 *
 * Load-bearing because its failure is silent. If it wrongly reports fresh, the
 * deploy ships a bundle whose judge predates the fix that was just made, and
 * nothing anywhere says so — the player just meets the same wrong rejection
 * again. Wrongly reporting stale costs four minutes and is visible. Every case
 * here is written from that asymmetry.
 *
 * The input list is asserted against the real repository, since that is where
 * an input can go missing from it. The predicate itself is exercised against a
 * throwaway repo in a temp directory, because the assertion is about
 * *timestamps*, which a real checkout has whatever it has.
 */

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexInputs, indexStaleness, writeIndexArtifact } from "../indexArtifact.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The inputs as repo-relative paths, with separators the assertions can read. */
function inputsOf(root: string): string[] {
  return indexInputs(root).map((path) => path.slice(root.length).replace(/\\/g, "/"));
}

const now = Date.now();
const DAY_AGO = new Date(now - 24 * 60 * 60 * 1000);
const HOUR_AGO = new Date(now - 60 * 60 * 1000);

function touch(path: string, at: Date = new Date()): void {
  utimesSync(path, at, at);
}

/**
 * A repo with every input present and an artifact built after all of them.
 * Timestamps are set explicitly: the filesystem's own resolution is coarse
 * enough that "written second" and "newer" are not the same claim.
 *
 * `skip` leaves named inputs (basenames) off the disk entirely — for exercising
 * what an *absent* input does, `tier-overrides.csv` above all, without
 * tripping over one of the other inputs being absent for the same reason.
 */
function repo(skip: string[] = []): { root: string; artifact: string } {
  const root = mkdtempSync(resolve(tmpdir(), "rhyme-bee-staleness-"));
  // One engine module and one test beside it, written before the inputs are
  // enumerated so the sweep of `src/` has something to find and something to
  // skip.
  mkdirSync(resolve(root, "src/__tests__"), { recursive: true });
  writeFileSync(resolve(root, "src/normalise.ts"), "// the rules");
  writeFileSync(resolve(root, "src/__tests__/normalise.test.ts"), "// the tests");

  for (const input of indexInputs(root)) {
    if (skip.some((name) => input.endsWith(name))) continue;
    mkdirSync(resolve(input, ".."), { recursive: true });
    writeFileSync(input, "input");
    touch(input, DAY_AGO);
  }
  // Files the index never reads, present so a test can touch one.
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  writeFileSync(resolve(root, "data/schedule.json"), "{}");
  writeFileSync(resolve(root, "scripts/play.ts"), "// the REPL");

  const outDir = resolve(root, "dist-data");
  mkdirSync(outDir, { recursive: true });
  const manifest = writeIndexArtifact(outDir, "the index");
  const artifact = resolve(outDir, manifest.index);
  touch(artifact, HOUR_AGO);
  return { root, artifact };
}

describe("the Rhyme Index input list", () => {
  const inputs = inputsOf(repoRoot);

  it("holds every file the build reads", () => {
    // Taken from `build-index.ts`: the predicate is only correct if complete,
    // and a forgotten input is a fix that silently never ships.
    expect(inputs).toEqual(
      expect.arrayContaining([
        "/data/sources.json",
        "/data/cmudict.dict",
        "/data/words.txt",
        "/data/names.txt",
        "/data/prevalence.csv",
        "/data/demotions.txt",
        "/data/supplement.dict",
        "/data/tier-overrides.csv",
      ]),
    );
  });

  it("does not hold the committed schedule", () => {
    // The schedule is read by the web bundle and never by the Index. Treating
    // it as an input would reinstate exactly the four minutes this removes.
    expect(inputs).not.toContain("/data/schedule.json");
  });

  it("holds the build's own source, data being only half of what it reads", () => {
    expect(inputs).toContain("/scripts/build-index.ts");
    expect(inputs).toContain("/src/normalise.ts");
  });

  it("leaves out the tests and fixtures beside that source", () => {
    expect(inputs.filter((path) => path.includes("__tests__"))).toEqual([]);
    expect(inputs.filter((path) => path.includes("__fixtures__"))).toEqual([]);
  });
});

describe("the staleness predicate", () => {
  it("reports fresh when nothing is newer than the artifact", () => {
    expect(indexStaleness(repo().root)).toEqual({ stale: false, reason: null });
  });

  it("reports stale when a data input is newer than the artifact", () => {
    const { root } = repo();
    touch(resolve(root, "data/supplement.dict"));
    expect(indexStaleness(root)).toEqual({
      stale: true,
      reason: "input-newer",
      input: resolve(root, "data/supplement.dict"),
    });
  });

  it("reports stale when the build's own source is newer than the artifact", () => {
    // The gap #134 did not settle: a code change to the build is not a data
    // change, so without this an edited normalisation rule would never ship.
    const { root } = repo();
    touch(resolve(root, "src/normalise.ts"));
    expect(indexStaleness(root).stale).toBe(true);
  });

  it("reports stale when an input is missing", () => {
    // `words.txt` and `names.txt` are gitignored and regenerable (ADR-0003), so
    // a fresh clone has no copy at all. That is not evidence of freshness.
    const root = mkdtempSync(resolve(tmpdir(), "rhyme-bee-staleness-"));
    mkdirSync(resolve(root, "dist-data"), { recursive: true });
    writeIndexArtifact(resolve(root, "dist-data"), "the index");
    const staleness = indexStaleness(root);
    expect(staleness.stale).toBe(true);
    expect(staleness.reason).toBe("missing-input");
  });

  it("does not report stale when only tier-overrides.csv is missing", () => {
    // ADR-0015 fixes a missing override file as a legitimate no-op, the same
    // standing an empty one has — unlike every other input here, which is
    // missing only because a setup step has not run yet.
    const { root } = repo(["tier-overrides.csv"]);
    expect(indexStaleness(root)).toEqual({ stale: false, reason: null });
  });

  it("reports stale once tier-overrides.csv exists and is newer than the artifact", () => {
    // The other half of the same rule: absence is a no-op, but a real edit —
    // an Editor's Pass appending a row — must still trigger the rebuild that
    // ships it, the same as any other input.
    const { root } = repo();
    touch(resolve(root, "data/tier-overrides.csv"));
    expect(indexStaleness(root)).toEqual({
      stale: true,
      reason: "input-newer",
      input: resolve(root, "data/tier-overrides.csv"),
    });
  });

  it("reports stale when no index has been built at all", () => {
    const root = mkdtempSync(resolve(tmpdir(), "rhyme-bee-staleness-"));
    expect(indexStaleness(root)).toEqual({ stale: true, reason: "no-artifact" });
  });

  it("does not report stale when only the committed schedule was touched", () => {
    // A Seed Word swap. This is the whole point of the predicate: seconds, not
    // four minutes, for a change the judge cannot see.
    const { root } = repo();
    touch(resolve(root, "data/schedule.json"));
    expect(indexStaleness(root).stale).toBe(false);
  });

  it("does not report stale when a script the Index never reads was touched", () => {
    const { root } = repo();
    touch(resolve(root, "scripts/play.ts"));
    expect(indexStaleness(root).stale).toBe(false);
  });

  it("breaks a same-instant tie toward rebuilding", () => {
    // An input written in the same millisecond as the artifact cannot be
    // ordered against it, and an unresolvable case rebuilds: the wasted four
    // minutes is the error that is visible.
    const { root, artifact } = repo();
    const at = new Date(now - 90 * 60 * 1000);
    touch(artifact, at);
    touch(resolve(root, "data/cmudict.dict"), at);
    expect(indexStaleness(root).stale).toBe(true);
  });
});
