/**
 * The primary suite: a verdict table. Every case argued during design is a row,
 * because each one encodes a decision someone would otherwise re-litigate. The
 * unit of testing is a (Seed Word, Submission) -> verdict triple; nothing here
 * reaches into phoneme parsing, stress scanning, or lemmatisation. Swapping the
 * fixture for another pronunciation source with equivalent content would leave
 * every assertion standing.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { RejectionReason, Tier } from "../verdict.ts";

const index = makeTestIndex();

type Expected =
  | { outcome: Tier }
  | { outcome: "rejected"; reason: RejectionReason };

interface Row {
  seed: string;
  submission: string;
  expected: Expected;
  note: string;
}

const table: Row[] = [
  { seed: "ate", submission: "late", expected: { outcome: "answer" }, note: "obvious rhyme" },
  { seed: "ate", submission: "eight", expected: { outcome: "answer" }, note: "homophone" },
  { seed: "ate", submission: "collate", expected: { outcome: "answer" }, note: "primary stress" },
  { seed: "ate", submission: "impregnate", expected: { outcome: "answer" }, note: "secondary stress" },
  { seed: "ate", submission: "adjudicate", expected: { outcome: "answer" }, note: "secondary stress" },
  { seed: "ate", submission: "defenestrate", expected: { outcome: "answer" }, note: "rare but known" },
  { seed: "ate", submission: "objurgate", expected: { outcome: "bonus" }, note: "genuine but obscure" },
  { seed: "ate", submission: "chocolate", expected: { outcome: "rejected", reason: "does-not-rhyme" }, note: "unstressed schwa" },
  { seed: "ate", submission: "commensurate", expected: { outcome: "rejected", reason: "does-not-rhyme" }, note: "unstressed schwa" },
  { seed: "ate", submission: "hat", expected: { outcome: "rejected", reason: "does-not-rhyme" }, note: "near-rhyme" },
  { seed: "ate", submission: "Kate", expected: { outcome: "rejected", reason: "proper-noun" }, note: "a name" },
  { seed: "ate", submission: "ate", expected: { outcome: "rejected", reason: "is-the-seed-word" }, note: "cannot farm the seed" },
  { seed: "bed", submission: "read", expected: { outcome: "answer" }, note: "variant pronunciation" },
  { seed: "beer", submission: "tear", expected: { outcome: "answer" }, note: "variant pronunciation" },
  { seed: "care", submission: "tear", expected: { outcome: "answer" }, note: "the other variant" },
];

describe("verdict table", () => {
  for (const { seed, submission, expected, note } of table) {
    const label =
      expected.outcome === "rejected"
        ? `${expected.outcome} — ${expected.reason}`
        : expected.outcome;
    it(`${seed} + ${submission} -> ${label} (${note})`, () => {
      const verdict = index.adjudicate(index.pinSeed(seed), submission);
      expect(verdict.outcome).toBe(expected.outcome);
      if (expected.outcome === "rejected" && verdict.outcome === "rejected") {
        expect(verdict.reason).toBe(expected.reason);
      }
    });
  }
});
