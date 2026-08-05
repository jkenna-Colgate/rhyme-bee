/**
 * The supplement-candidate queue is append-only JSON Lines, jotted mid-play and
 * judged later. A corrupt line must never block judging the rest of the queue.
 *
 * Deployed, the same record arrives from a public endpoint, so the second half
 * of this file is about what an *untrusted* report is allowed to be, and about
 * the object key #120 has to be able to find these under.
 */

import { describe, expect, it } from "vitest";
import {
  candidateFromReport,
  candidateKey,
  parseCandidates,
  serialiseCandidate,
  type SupplementCandidate,
} from "../supplementCandidate.ts";

const candidate: SupplementCandidate = {
  word: "airburst",
  seedWord: "burst",
  seedRhymeKey: "ER S T",
  reason: "not-a-known-word",
  engineRespelling: null,
  timestamp: "2026-07-27T19:00:00.000Z",
};

describe("supplement candidate queue", () => {
  it("round-trips a candidate through serialise/parse", () => {
    const line = serialiseCandidate(candidate);
    expect(line.endsWith("\n")).toBe(true);
    expect(parseCandidates(line)).toEqual([candidate]);
  });

  it("reads a multi-line append-only queue in order", () => {
    const second = { ...candidate, word: "overjoy", seedWord: "joy", seedRhymeKey: "OY" };
    const queue = serialiseCandidate(candidate) + serialiseCandidate(second);
    expect(parseCandidates(queue).map((c) => c.word)).toEqual(["airburst", "overjoy"]);
  });

  it("skips blank lines and drops a corrupt record without losing the rest", () => {
    const queue = serialiseCandidate(candidate) + "\nnot json\n{}\n";
    expect(parseCandidates(queue)).toEqual([candidate]);
  });
});

const TIMESTAMP = "2026-08-05T19:00:00.000Z";

/** What the game itself sends: the play context, minus the timestamp. */
const report = {
  word: "Airburst",
  seedWord: "burst",
  seedRhymeKey: "ER S T",
  reason: "not-a-known-word",
  engineRespelling: null,
};

describe("reading an untrusted report", () => {
  it("coerces a well-formed report into the record shape, timestamped by capture", () => {
    expect(candidateFromReport(report, TIMESTAMP)).toEqual({
      ok: true,
      candidate: { ...candidate, timestamp: TIMESTAMP },
    });
  });

  it("keeps the engine's respelling when one is offered", () => {
    const result = candidateFromReport(
      { ...report, reason: "does-not-rhyme", engineRespelling: "AIR-burst" },
      TIMESTAMP,
    );
    expect(result.ok && result.candidate.engineRespelling).toBe("AIR-burst");
  });

  it("refuses a rejection reason the engine could never have given", () => {
    expect(candidateFromReport({ ...report, reason: "vibes" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, reason: 7 }, TIMESTAMP).ok).toBe(false);
  });

  it("refuses a word that is not the shape a Submission may take", () => {
    expect(candidateFromReport({ ...report, word: "air burst" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, word: "<script>" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, word: "" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, word: "a".repeat(46) }, TIMESTAMP).ok).toBe(false);
  });

  it("refuses an unrecognisable Seed Word or Rhyme Key", () => {
    expect(candidateFromReport({ ...report, seedWord: "burst!" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, seedRhymeKey: "er s t" }, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport({ ...report, seedRhymeKey: "" }, TIMESTAMP).ok).toBe(false);
  });

  it("refuses a respelling that is not one", () => {
    expect(
      candidateFromReport({ ...report, engineRespelling: "ɛr bɜrst" }, TIMESTAMP).ok,
    ).toBe(false);
  });

  it("refuses a field nobody recognises rather than dropping it", () => {
    expect(candidateFromReport({ ...report, note: "hello" }, TIMESTAMP).ok).toBe(false);
  });

  it("refuses a timestamp from the sender — capture owns when a flag arrived", () => {
    expect(candidateFromReport({ ...report, timestamp: TIMESTAMP }, TIMESTAMP).ok).toBe(false);
  });

  it("refuses anything that is not a JSON object", () => {
    expect(candidateFromReport(null, TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport([report], TIMESTAMP).ok).toBe(false);
    expect(candidateFromReport("airburst", TIMESTAMP).ok).toBe(false);
  });

  it("never yields a partial record — a refusal carries no candidate at all", () => {
    const result = candidateFromReport({ word: "airburst" }, TIMESTAMP);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("the object key one flag is stored under", () => {
  it("is the timestamp then the word, under the queue's prefix", () => {
    expect(candidateKey({ ...candidate, timestamp: TIMESTAMP })).toBe(
      "flags/2026-08-05T19-00-00-000Z-airburst.json",
    );
  });

  it("carries no character a filesystem will refuse", () => {
    expect(candidateKey({ ...candidate, timestamp: TIMESTAMP })).not.toMatch(/[:*?"<>|]/);
  });

  it("sorts chronologically, so a listing is the queue in order", () => {
    const earlier = candidateKey({ ...candidate, timestamp: "2026-08-05T09:00:00.000Z" });
    const later = candidateKey({ ...candidate, timestamp: "2026-08-05T19:00:00.000Z" });
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});
