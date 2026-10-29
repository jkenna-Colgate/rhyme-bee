/**
 * A **Session Record** (GLOSSARY.md, ADR-0019): a copy of one Daily Puzzle
 * Session, sent from the player's browser after the fact so the game can be
 * measured against real play. It is the stored snapshot exactly as
 * `sessionSnapshot.ts` writes it (date, Seed Word and Rhyme Key, every
 * Submission as typed and in order, whether it ended), plus two fields the
 * snapshot does not carry:
 *
 * - `id`, random per Session. It links nothing across days. Its only job is that
 *   a Session sent again as it grows replaces its earlier copy.
 * - `indexHash`, the content hash of the Rhyme Index in the sending build, on a
 *   Session for the sender's own today only. Nothing recorded which index judged
 *   a past date, so a record for one omits it rather than guess.
 *
 * Nothing in it says who played: no player or browser identifier, no timestamp,
 * no IP address. A record never asks for a verdict (ADR-0013); Rank, Score and
 * each rejection are read off it later by replaying it against the Rhyme Index
 * (`sessionRecordReplay.ts`).
 *
 * This module is the pure contract between the three places a record passes
 * through: the browser that sends it, the Worker route that keeps it, and the
 * pull that brings it home. It holds the shape, the validation that turns an
 * untrusted body into one, and the object key, as `supplementCandidate.ts` does
 * for Appeals. It imports nothing heavier than that, because the Worker bundles
 * it.
 */

import { hasOnlyFields, refuse, type Validated } from "./report.ts";

export interface SessionRecord {
  /** 32 lower-case hex digits, random per Session. */
  id: string;
  /** The Daily Puzzle's date, `YYYY-MM-DD`, in the player's own calendar. */
  date: string;
  seed: { word: string; rhymeKey: string };
  /** Every Submission as typed, in order, accepted or rejected. */
  submissions: string[];
  /** Whether the Reveal was taken. */
  ended: boolean;
  /** The sending build's Rhyme Index hash, present only on a record for that day. */
  indexHash?: string;
}

/**
 * The most Submissions a record may hold. Generous: a Puzzle's size band keeps
 * its Answers to a few dozen, and a keen player trying everything that comes to
 * mind still lands far short of this.
 */
export const MAX_SUBMISSIONS = 500;

/**
 * The largest body the route reads, in bytes: `MAX_SUBMISSIONS` Submissions at
 * the longest length a word may take, with room for the JSON around them. It is
 * also under the 64 KiB a browser lets a page-hiding request carry.
 */
export const MAX_RECORD_BYTES = 32 * 1024;

const MAX_WORD_LENGTH = 45;
const MAX_RHYME_KEY_LENGTH = 60;

const ID_SHAPE = /^[0-9a-f]{32}$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INDEX_HASH_SHAPE = /^[0-9a-f]{8,64}$/;
/** The Seed Word as the engine pins one: letters only. */
const SEED_SHAPE = /^[a-z]+$/;
/** Space-separated ARPABET with the stress digits stripped, as `rhymeKeyOf` emits. */
const RHYME_KEY_SHAPE = /^[A-Z]+( [A-Z]+)*$/;
/**
 * What a Submission must look like to be kept. Looser than the engine's own
 * `[a-z]+`, on purpose: a Submission is kept as typed, and the ones the engine
 * refuses as malformed (`Don't`, `rock and roll`) are part of the Session as
 * played. What it shuts out is the stray paste ADR-0019 names, which carries a
 * digit, a slash, a line break or a sentence's punctuation, or runs long.
 */
const SUBMISSION_SHAPE = /^[\p{L}'’-]+( [\p{L}'’-]+)*$/u;

const RECORD_FIELDS = new Set(["id", "date", "seed", "submissions", "ended", "indexHash"]);
const SEED_FIELDS = new Set(["word", "rhymeKey"]);

export type SessionRecordReport = Validated<"record", SessionRecord>;

/** True for `YYYY-MM-DD` naming a day the calendar has. */
function isCalendarDate(value: string): boolean {
  const match = DATE_SHAPE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Coerce an untrusted body into a Session Record, or refuse it. Every field is
 * checked rather than trusted, and the date and the id strictly, because both go
 * into the object key. A field nobody recognises refuses the whole record rather
 * than being trimmed off, which is also what keeps an identifier from riding in
 * on a body the game did not send.
 */
export function recordFromBody(body: unknown): SessionRecordReport {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse("A Session Record must be a JSON object.");
  }
  const report = body as Record<string, unknown>;
  if (!hasOnlyFields(report, RECORD_FIELDS)) return refuse("Unrecognised field in record.");

  if (typeof report.id !== "string" || !ID_SHAPE.test(report.id)) {
    return refuse("That is not a Session id.");
  }
  if (typeof report.date !== "string" || !isCalendarDate(report.date)) {
    return refuse("That is not a date.");
  }

  const seed = report.seed;
  if (typeof seed !== "object" || seed === null || Array.isArray(seed)) {
    return refuse("A Seed Word is required.");
  }
  const seedFields = seed as Record<string, unknown>;
  if (!hasOnlyFields(seedFields, SEED_FIELDS)) return refuse("Unrecognised field in Seed.");
  const { word, rhymeKey } = seedFields;
  if (typeof word !== "string" || word.length > MAX_WORD_LENGTH || !SEED_SHAPE.test(word)) {
    return refuse("That is not a Seed Word.");
  }
  if (
    typeof rhymeKey !== "string" ||
    rhymeKey.length > MAX_RHYME_KEY_LENGTH ||
    !RHYME_KEY_SHAPE.test(rhymeKey)
  ) {
    return refuse("That is not a Rhyme Key.");
  }

  if (!Array.isArray(report.submissions)) return refuse("Submissions must be a list.");
  if (report.submissions.length > MAX_SUBMISSIONS) return refuse("Too many Submissions.");
  for (const submission of report.submissions) {
    if (
      typeof submission !== "string" ||
      submission.length > MAX_WORD_LENGTH ||
      !SUBMISSION_SHAPE.test(submission)
    ) {
      return refuse("A Submission is not word-shaped.");
    }
  }

  if (typeof report.ended !== "boolean") return refuse("Whether it ended is required.");

  const record: SessionRecord = {
    id: report.id,
    date: report.date,
    seed: { word, rhymeKey },
    submissions: [...(report.submissions as string[])],
    ended: report.ended,
  };

  if (report.indexHash !== undefined) {
    if (typeof report.indexHash !== "string" || !INDEX_HASH_SHAPE.test(report.indexHash)) {
      return refuse("That is not an index hash.");
    }
    record.indexHash = report.indexHash;
  }

  return { ok: true, record };
}

/** The stored form of a record: its JSON, one object per bucket entry. */
export function serialiseSessionRecord(record: SessionRecord): string {
  return JSON.stringify(record);
}

/**
 * Read a stored record back, or null if the text does not hold one. The same
 * validation as the route, so a record the pull reads is one the route would
 * have kept.
 */
export function parseSessionRecord(text: string): SessionRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const result = recordFromBody(value);
  return result.ok ? result.record : null;
}

/**
 * Where Session Records live in the bucket the Appeals use. Its own prefix, so
 * neither pull meets the other's objects.
 */
export const SESSION_RECORD_KEY_PREFIX = "sessions/";

/**
 * The object key one record is kept under:
 *
 *     sessions/<date>/<id>.json
 *
 * Derived from the date and the id alone, so a Session sent again as it grows
 * overwrites its earlier copy, and a listing reads in date order.
 */
export function sessionRecordKey(record: Pick<SessionRecord, "date" | "id">): string {
  return `${SESSION_RECORD_KEY_PREFIX}${record.date}/${record.id}.json`;
}
