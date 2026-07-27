/**
 * The supplement-candidate queue is append-only JSON Lines, jotted mid-play and
 * judged later. A corrupt line must never block judging the rest of the queue.
 */

import { describe, expect, it } from "vitest";
import {
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
