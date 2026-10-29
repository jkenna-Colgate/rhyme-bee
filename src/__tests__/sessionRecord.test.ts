/**
 * The Session Record's shape (ADR-0019): what an untrusted body must be before
 * the route keeps it, and the object key it is kept under. Transport is tested
 * apart, in `web/worker/__tests__/sessionRecordRoute.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SUBMISSIONS,
  parseSessionRecord,
  recordFromBody,
  serialiseSessionRecord,
  sessionRecordKey,
  SESSION_RECORD_KEY_PREFIX,
} from "../sessionRecord.ts";

const ID = "0123456789abcdef0123456789abcdef";

const body = {
  id: ID,
  date: "2026-10-29",
  seed: { word: "cup", rhymeKey: "AH P" },
  submissions: ["pup", "Kate", "makeup", "zzzq"],
  ended: false,
  indexHash: "6097632138aad59e",
};

describe("a Session Record body", () => {
  it("is kept as the stored snapshot plus the id and the index hash", () => {
    expect(recordFromBody(body)).toEqual({ ok: true, record: body });
  });

  it("is kept without an index hash, which a past date's record omits", () => {
    const { indexHash: _omitted, ...past } = body;
    expect(recordFromBody(past)).toEqual({ ok: true, record: past });
  });

  it("keeps every Submission exactly as typed, rejected ones included", () => {
    const typed = ["Late", "don't", "rock and roll", "café", "weight"];
    const result = recordFromBody({ ...body, submissions: typed });
    expect(result.ok && result.record.submissions).toEqual(typed);
  });

  it("is refused with a field nobody recognises, such as anything identifying", () => {
    expect(recordFromBody({ ...body, player: "abc" }).ok).toBe(false);
    expect(recordFromBody({ ...body, ip: "203.0.113.9" }).ok).toBe(false);
    expect(recordFromBody({ ...body, seed: { ...body.seed, extra: 1 } }).ok).toBe(false);
  });

  it.each([
    ["an id that is not 32 lower-case hex digits", { id: "../../flags/x" }],
    ["an upper-case id", { id: ID.toUpperCase() }],
    ["a date that is not YYYY-MM-DD", { date: "2026-10-29/../x" }],
    ["a date that is no calendar date", { date: "2026-02-30" }],
    ["a Seed Word that is not letters", { seed: { word: "c up", rhymeKey: "AH P" } }],
    ["a Rhyme Key that is not one", { seed: { word: "cup", rhymeKey: "ah p" } }],
    ["an ended flag that is not a boolean", { ended: "yes" }],
    ["submissions that are not a list", { submissions: "pup" }],
    ["an index hash that is not hex", { indexHash: "../index" }],
  ])("is refused with %s", (_, change) => {
    expect(recordFromBody({ ...body, ...change }).ok).toBe(false);
  });

  it("is refused when a Submission is not word-shaped, so a stray paste is not kept", () => {
    for (const paste of ["https://example.com/x", "see you at 5", "a\nb", "", "word;", "  "]) {
      expect(recordFromBody({ ...body, submissions: ["pup", paste] }).ok).toBe(false);
    }
  });

  it("is refused when a Submission is oversized", () => {
    expect(recordFromBody({ ...body, submissions: ["a".repeat(46)] }).ok).toBe(false);
    expect(recordFromBody({ ...body, submissions: ["a".repeat(45)] }).ok).toBe(true);
  });

  it("is refused past the cap on Submissions", () => {
    const many = Array.from({ length: MAX_SUBMISSIONS + 1 }, () => "pup");
    expect(recordFromBody({ ...body, submissions: many }).ok).toBe(false);
    expect(recordFromBody({ ...body, submissions: many.slice(1) }).ok).toBe(true);
  });

  it("is refused when it is not an object", () => {
    for (const value of [null, [], "record", 3]) expect(recordFromBody(value).ok).toBe(false);
  });
});

describe("where a Session Record is kept", () => {
  it("is keyed by date and the per-Session id, so a resend overwrites it", () => {
    const result = recordFromBody(body);
    if (!result.ok) throw new Error(result.error);
    expect(sessionRecordKey(result.record)).toBe(`sessions/2026-10-29/${ID}.json`);
    expect(SESSION_RECORD_KEY_PREFIX).toBe("sessions/");

    const grown = recordFromBody({ ...body, submissions: [...body.submissions, "up"], ended: true });
    if (!grown.ok) throw new Error(grown.error);
    expect(sessionRecordKey(grown.record)).toBe(sessionRecordKey(result.record));
  });

  it("round-trips through its stored serialisation", () => {
    const result = recordFromBody(body);
    if (!result.ok) throw new Error(result.error);
    expect(parseSessionRecord(serialiseSessionRecord(result.record))).toEqual(body);
    expect(parseSessionRecord("not json")).toBeNull();
    expect(parseSessionRecord(JSON.stringify({ ...body, id: "x" }))).toBeNull();
  });
});
