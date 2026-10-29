/**
 * Pulled Session Records on the maintainer's machine (ADR-0019, #230): which of
 * the bucket's objects a pull fetches, where each lands, and reading them back.
 *
 * Records land in `data/session-records/<date>/<id>.json`, mirroring their
 * object keys. That path is gitignored with the rest of `data/` and must stay
 * so: Session Records are never committed. Nothing is ever deleted, here or in
 * the bucket, because nobody will be there to prune them.
 *
 * `readPulledRecords` is the reader every consumer shares: `npm run
 * records:replay` today, and the Tier moves that read Retrieval off real play
 * (#270) next.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { addDays } from "../src/schedule.ts";
import {
  parseSessionRecord,
  SESSION_RECORD_KEY_PREFIX,
  type SessionRecord,
} from "../src/sessionRecord.ts";

/** Where `npm run records:pull` writes, relative to the repository root. */
export const SESSION_RECORDS_DIR = join("data", "session-records");

/** `sessions/<date>/<id>.json`, the only key shape the route writes. */
const KEY_SHAPE = new RegExp(
  `^${SESSION_RECORD_KEY_PREFIX}(\\d{4}-\\d{2}-\\d{2})/([0-9a-f]{32})\\.json$`,
);

function parseKey(key: string): { date: string; id: string } | null {
  const match = KEY_SHAPE.exec(key);
  return match === null ? null : { date: match[1]!, id: match[2]! };
}

/**
 * The keys to fetch: every Session Record key not yet pulled, and a pulled one
 * again only while its date may still be in play. A player plays a date only
 * while it is their own calendar date, so once that date is over in every time
 * zone (`today` and the day before cover the spread) the Session cannot grow,
 * and the copy already held is the last one. Keys in any other shape are passed
 * over, so a stray object cannot steer a write outside the records directory.
 */
export function keysToFetch(
  keys: readonly string[],
  held: ReadonlySet<string>,
  today: string,
): string[] {
  const stillInPlay = addDays(today, -1);
  return keys.filter((key) => {
    const parsed = parseKey(key);
    if (parsed === null) return false;
    return !held.has(key) || parsed.date >= stillInPlay;
  });
}

/** The local file a key is kept in. Throws for a key the route would never write. */
export function recordFilePath(dir: string, key: string): string {
  const parsed = parseKey(key);
  if (parsed === null) throw new Error(`Not a Session Record key: ${key}`);
  return resolve(dir, parsed.date, `${parsed.id}.json`);
}

/** Write one pulled object to its file, replacing an earlier pull of it. */
export function writePulledRecord(dir: string, key: string, body: string): void {
  const path = recordFilePath(dir, key);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
}

/** The keys of every record already pulled into `dir`. */
export function pulledKeys(dir: string): Set<string> {
  const keys = new Set<string>();
  for (const { date, file } of recordFiles(dir)) {
    keys.add(`${SESSION_RECORD_KEY_PREFIX}${date}/${file}`);
  }
  return keys;
}

function recordFiles(dir: string): { date: string; file: string }[] {
  if (!existsSync(dir)) return [];
  const files: { date: string; file: string }[] = [];
  for (const date of readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const file of readdirSync(join(dir, date)).sort()) {
      if (file.endsWith(".json")) files.push({ date, file });
    }
  }
  return files;
}

export interface PulledRecords {
  /** Every readable record, in date order. */
  records: SessionRecord[];
  /** Files that hold no record the route would have kept. */
  unreadable: string[];
}

/** Every record pulled into `dir`, read back. An absent directory is an empty set. */
export function readPulledRecords(dir: string): PulledRecords {
  const records: SessionRecord[] = [];
  const unreadable: string[] = [];
  for (const { date, file } of recordFiles(dir)) {
    const path = join(dir, date, file);
    const record = parseSessionRecord(readFileSync(path, "utf8"));
    if (record === null) unreadable.push(path);
    else records.push(record);
  }
  return { records, unreadable };
}
