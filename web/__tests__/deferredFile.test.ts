/**
 * The deferred readings file's **file**, as opposed to its format: what
 * `readDeferredReadings` comes back with for each state a real
 * `data/deferred-readings.jsonl` can be in (#181).
 *
 * The format is `scripts/editorDeferred.ts`'s and is tested there. What is
 * tested here is the pair of states the ticket names as the ones that must not
 * be failures — a file with nothing in it, which is the file's state in the
 * repository today, and no file at all, which is a fresh clone that has never
 * run an add. Both are "no deferrals", and getting either of them wrong is a
 * section that refuses to render over the ordinary case.
 *
 * The real path is not exercised: the point of the injected path is that a test
 * stands in for the file, which is `AddDeps.deferredPath`'s own argument on the
 * writing side of the same file.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDeferredReadings } from "../deferredFile.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-deferred-"));
  path = join(dir, "deferred-readings.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const UNAVAILABLE = JSON.stringify({
  word: "candleholder",
  rhymeKey: "OW L D ER",
  reason: "agent-unavailable",
  proposed: null,
  timestamp: "2026-08-07T20:05:18.132Z",
});

/** `hectoliter`'s own reading, which lands on `IY D ER` and so misses the target. */
const HECTOLITER = ["HH", "EH1", "K", "T", "OW0", "L", "IY2", "D", "ER0"];

const REFUSED = JSON.stringify({
  word: "hectoliter",
  rhymeKey: "OW L D ER",
  reason: "agent-reading-failed-verification",
  proposed: HECTOLITER,
  timestamp: "2026-08-07T20:06:02.007Z",
});

describe("reading the deferred readings back", () => {
  it("reads every record the add path appended", () => {
    writeFileSync(path, `${UNAVAILABLE}\n${REFUSED}\n`);

    const records = readDeferredReadings(path);

    expect(records.map((r) => [r.word, r.reason])).toEqual([
      ["candleholder", "agent-unavailable"],
      ["hectoliter", "agent-reading-failed-verification"],
    ]);
    expect(records[1]!.proposed).toEqual(HECTOLITER);
  });

  // The live case: the file is zero bytes in the repository, and an empty
  // section is the good news rather than a fault.
  it("reads an empty file as no deferrals rather than throwing", () => {
    writeFileSync(path, "");

    expect(readDeferredReadings(path)).toEqual([]);
  });

  it("reads a file that does not exist as no deferrals rather than throwing", () => {
    expect(readDeferredReadings(join(dir, "never-written.jsonl"))).toEqual([]);
  });
});
