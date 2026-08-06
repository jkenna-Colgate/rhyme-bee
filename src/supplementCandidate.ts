/**
 * A play-testing candidate for the pronunciation supplement (ADR-0009): a
 * Submission a player Appealed mid-play as *should have counted as an Answer*,
 * captured with the context a judge needs to act on it later. Capture only
 * records; the judging — is this a real word, an add or a stress correction,
 * what reading — happens on a later run against the queue.
 *
 * Nothing here adjudicates. The verdict was reached in the player's browser and
 * stays there (ADR-0013); a candidate is a report *about* a verdict already
 * given, never a request for one.
 *
 * Two capture paths write the same record. In dev it is a button → the dev
 * server, appending to `data/supplement-candidates.jsonl` (a scratch file,
 * gitignored with the rest of `data/`). Deployed it is a button → a route on the
 * Worker, writing one R2 object per Appeal. Both reach a queue of JSON Lines,
 * which is why `serialiseCandidate` is the serialisation on both paths and why
 * the pull-down that reassembles the objects gets a queue `parseCandidates`
 * already reads.
 *
 * This module is the pure record shape: its (de)serialisation, the validation
 * that turns an *untrusted* report into one, and the key one is stored under.
 * The IO and the judging live elsewhere.
 */

import { normaliseWord } from "./cmudict.ts";
import { hasOnlyFields, refuse, type Validated } from "./report.ts";
import { REJECTION_MESSAGE, type RejectionReason } from "./verdict.ts";

export interface SupplementCandidate {
  /** The Submission the player says should have counted as an Answer. */
  word: string;
  /** The Seed Word it was played against — what it must rhyme with. */
  seedWord: string;
  /** The Seed's pinned Rhyme Key — the target the judge authors stress toward. */
  seedRhymeKey: string;
  /** Why the engine rejected it — the judge's first hint at add vs correction. */
  reason: RejectionReason;
  /**
   * For a `does-not-rhyme` rejection, the reading the engine used (respelled), so
   * the judge can see which stress it must correct. Null for the other reasons.
   */
  engineRespelling: string | null;
  /** When the Appeal was raised (ISO 8601). */
  timestamp: string;
}

/** Serialise one candidate to a single JSON Lines record (newline included). */
export function serialiseCandidate(candidate: SupplementCandidate): string {
  return JSON.stringify(candidate) + "\n";
}

/**
 * Parse a JSON Lines queue into candidates. Blank lines are skipped, and a line
 * that isn't a well-formed candidate is dropped rather than throwing — one
 * corrupt jot must never block judging the rest of a session's queue.
 */
export function parseCandidates(text: string): SupplementCandidate[] {
  const out: SupplementCandidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isCandidate(parsed)) out.push(parsed);
  }
  return out;
}

// --- Untrusted reports -------------------------------------------------------

/**
 * The largest report body the deployed endpoint will read, in bytes. A candidate
 * is six short fields; a kilobyte is generous for the longest word in English
 * Appealed against the longest Rhyme Key, and small enough that a body is cheap
 * to refuse.
 */
export const MAX_REPORT_BYTES = 1024;

/** The fields a report may carry. Anything else is a refusal, not a shrug. */
const REPORT_FIELDS = new Set([
  "word",
  "seedWord",
  "seedRhymeKey",
  "reason",
  "engineRespelling",
]);

/** The accepted Submission shape — the engine's own, letters only. */
const SUBMISSION_SHAPE = /^[a-z]+$/;
/** Space-separated ARPABET with the stress digits stripped, as `rhymeKeyOf` emits. */
const RHYME_KEY_SHAPE = /^[A-Z]+( [A-Z]+)*$/;
/** Hyphen-joined syllables of letters, as `respell` emits. */
const RESPELLING_SHAPE = /^[A-Za-z]+(-[A-Za-z]+)*$/;

const MAX_WORD_LENGTH = 45;
const MAX_RHYME_KEY_LENGTH = 60;
const MAX_RESPELLING_LENGTH = 120;

/**
 * The outcome of reading an untrusted report: either a whole candidate or a
 * refusal. There is deliberately no third state — a caller cannot get half a
 * record out of this, so a refusal can never be half-written. Shares its
 * shape with `NoteReport` (`web/src/feedback/feedbackIssue.ts`) via `Validated`
 * (`./report.ts`); only the fields of a candidate are specific to this module.
 */
export type CandidateReport = Validated<"candidate", SupplementCandidate>;

/**
 * Coerce an untrusted report body into a candidate, or refuse it.
 *
 * The body is whatever a public endpoint was sent, so every field is checked
 * rather than trusted: the rejection reason must be one the engine can actually
 * give, the word and Seed must be the shape a Submission is allowed to take, and
 * a field nobody recognises means the sender is not the game — so the whole
 * report goes, rather than being quietly trimmed to the parts we liked.
 *
 * `reason` is checked against `REJECTION_MESSAGE`, not a second hand-written
 * list. That table is a `Record<RejectionReason, string>`, so it is exhaustive
 * by construction (ADR-0005): adding a reason to the closed set cannot compile
 * without extending the table, and this validation follows it for free.
 *
 * The timestamp is the caller's, never the sender's — capture owns when an
 * Appeal arrived, and a client that could name it could scatter records across
 * the queue's ordering.
 */
export function candidateFromReport(body: unknown, timestamp: string): CandidateReport {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse("A report must be a JSON object.");
  }
  const report = body as Record<string, unknown>;

  if (!hasOnlyFields(report, REPORT_FIELDS)) return refuse("Unrecognised field in report.");

  if (typeof report.word !== "string") return refuse("A word is required.");
  const word = normaliseWord(report.word);
  if (word.length > MAX_WORD_LENGTH) return refuse("That word is too long.");
  if (!SUBMISSION_SHAPE.test(word)) return refuse("A word is letters only.");

  if (typeof report.seedWord !== "string") return refuse("A Seed Word is required.");
  const seedWord = normaliseWord(report.seedWord);
  if (seedWord.length > MAX_WORD_LENGTH) return refuse("That Seed Word is too long.");
  if (!SUBMISSION_SHAPE.test(seedWord)) return refuse("A Seed Word is letters only.");

  if (typeof report.seedRhymeKey !== "string") return refuse("A Rhyme Key is required.");
  const seedRhymeKey = report.seedRhymeKey.trim();
  if (seedRhymeKey.length > MAX_RHYME_KEY_LENGTH) return refuse("That Rhyme Key is too long.");
  if (!RHYME_KEY_SHAPE.test(seedRhymeKey)) return refuse("That is not a Rhyme Key.");

  if (typeof report.reason !== "string" || !Object.hasOwn(REJECTION_MESSAGE, report.reason)) {
    return refuse("That is not a rejection reason.");
  }
  const reason = report.reason as RejectionReason;

  let engineRespelling: string | null = null;
  if (report.engineRespelling !== undefined && report.engineRespelling !== null) {
    if (typeof report.engineRespelling !== "string") return refuse("That is not a respelling.");
    const respelling = report.engineRespelling.trim();
    if (respelling.length > MAX_RESPELLING_LENGTH) return refuse("That respelling is too long.");
    if (!RESPELLING_SHAPE.test(respelling)) return refuse("That is not a respelling.");
    engineRespelling = respelling;
  }

  return {
    ok: true,
    candidate: { word, seedWord, seedRhymeKey, reason, engineRespelling, timestamp },
  };
}

// --- Object storage ----------------------------------------------------------

/**
 * The prefix every Appealed word is written under in object storage, so the
 * pull-down can list the queue without meeting anything else in the bucket.
 * The prefix itself is the pre-existing object key format and is unchanged by
 * the Appeal rename, so anything already in the bucket still pulls down.
 */
export const CANDIDATE_KEY_PREFIX = "flags/";

/**
 * The object key one Appealed word is stored under:
 *
 *     flags/<timestamp>-<word>.json
 *
 * where `<timestamp>` is the record's ISO 8601 instant with `:` and `.` rewritten
 * to `-`, e.g. `flags/2026-08-05T19-00-00-000Z-airburst.json`.
 *
 * One object per Appeal rather than one appended file: two players Appealing in
 * the same second would race on a read-modify-write and one report would vanish
 * silently. The timestamp leads so that a plain lexicographic listing is also
 * chronological, and the word follows so a listing is readable without opening
 * anything. The punctuation is rewritten because the pull-down writes these keys
 * to a filesystem, and `:` is not a legal filename character on Windows.
 *
 * Two Appeals of the same word in the same millisecond collide, and the second
 * overwrites the first with an identical record — a duplicate lost, never a
 * distinct report.
 */
export function candidateKey(candidate: SupplementCandidate): string {
  const stamp = candidate.timestamp.replace(/[:.]/g, "-");
  return `${CANDIDATE_KEY_PREFIX}${stamp}-${candidate.word}.json`;
}

function isCandidate(value: unknown): value is SupplementCandidate {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.word === "string" &&
    typeof c.seedWord === "string" &&
    typeof c.seedRhymeKey === "string" &&
    typeof c.reason === "string" &&
    typeof c.timestamp === "string"
  );
}
