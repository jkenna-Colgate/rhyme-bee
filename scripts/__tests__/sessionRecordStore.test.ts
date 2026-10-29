/**
 * Where pulled Session Records are kept on the maintainer's machine, and which
 * of the bucket's objects a pull must fetch (ADR-0019, #230). The network half,
 * `pull-session-records.ts`, is thin and untested, as `pull-appeals.ts` is.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serialiseSessionRecord, sessionRecordKey, type SessionRecord } from "../../src/sessionRecord.ts";
import {
  keysToFetch,
  readPulledRecords,
  recordFilePath,
  writePulledRecord,
} from "../sessionRecordStore.ts";

const record = (date: string, id: string, submissions = ["late"]): SessionRecord => ({
  id: id.repeat(32),
  date,
  seed: { word: "ate", rhymeKey: "EY T" },
  submissions,
  ended: false,
});

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-records-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("which records a pull fetches", () => {
  const today = "2026-10-29";
  const keys = [
    sessionRecordKey(record("2026-10-29", "a")),
    sessionRecordKey(record("2026-10-28", "b")),
    sessionRecordKey(record("2026-10-27", "c")),
    sessionRecordKey(record("2026-08-06", "d")),
  ];

  it("fetches everything not yet pulled", () => {
    expect(keysToFetch(keys, new Set(), today)).toEqual(keys);
  });

  it("fetches again a held record whose date some player may still be playing", () => {
    // A date is still being played somewhere until it is over in every time
    // zone, so a record for today or yesterday may have grown since.
    expect(keysToFetch(keys, new Set(keys), today)).toEqual(keys.slice(0, 2));
  });

  it("passes over a key that is not a Session Record's", () => {
    expect(keysToFetch(["sessions/../flags/x.json", "sessions/2026-10-29/zz.json"], new Set(), today))
      .toEqual([]);
  });
});

describe("pulled records on disk", () => {
  it("are kept one file per record, by date and id, and read back for replay", () => {
    const dir = tempDir();
    const first = record("2026-10-28", "b");
    const second = record("2026-10-29", "a");
    writePulledRecord(dir, sessionRecordKey(first), serialiseSessionRecord(first));
    writePulledRecord(dir, sessionRecordKey(second), serialiseSessionRecord(second));

    expect(recordFilePath(dir, sessionRecordKey(first))).toBe(
      join(dir, "2026-10-28", `${"b".repeat(32)}.json`),
    );
    expect(readPulledRecords(dir).records).toEqual([first, second]);
  });

  it("overwrite a record pulled again after it grew", () => {
    const dir = tempDir();
    const key = sessionRecordKey(record("2026-10-29", "a"));
    writePulledRecord(dir, key, serialiseSessionRecord(record("2026-10-29", "a")));
    const grown = record("2026-10-29", "a", ["late", "eight"]);
    writePulledRecord(dir, key, serialiseSessionRecord(grown));
    expect(readPulledRecords(dir).records).toEqual([grown]);
  });

  it("report a file that holds no record rather than stopping on it", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "2026-10-29"), { recursive: true });
    writeFileSync(join(dir, "2026-10-29", `${"e".repeat(32)}.json`), "not json");
    const good = record("2026-10-29", "a");
    writePulledRecord(dir, sessionRecordKey(good), serialiseSessionRecord(good));

    const pulled = readPulledRecords(dir);
    expect(pulled.records).toEqual([good]);
    expect(pulled.unreadable).toHaveLength(1);
  });

  it("are an empty set when nothing has been pulled", () => {
    expect(readPulledRecords(join(tempDir(), "absent")).records).toEqual([]);
  });

  it("refuse a key that is not a Session Record's, so nothing is written outside the directory", () => {
    expect(() => writePulledRecord(tempDir(), "sessions/../../escape.json", "{}")).toThrow();
  });
});
