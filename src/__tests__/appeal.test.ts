/**
 * The Appeal, widened (#258, ADR-0020): any Submission the game did not count
 * as an Answer can be Appealed, a rejection, a Bonus Word, a Weak Rhyme and an
 * Unconfirmed Rhyme alike. The player cannot tell the last three apart on
 * screen, so the control cannot differ between them.
 *
 * Each case plays a word, asks what the Appeal would say of the verdict, and
 * sends that through the validation an untrusted report meets, so the control a
 * client offers is one the capture path will take.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { candidateFromReport } from "../supplementCandidate.ts";
import { serialiseUnconfirmedRhyme } from "../unconfirmedRhymes.ts";
import { appealedVerdict } from "../verdict.ts";

const index = makeTestIndex({
  pronunciations: [
    ["trick", [["T", "R", "IH1", "K"]]],
    ["magic", [["M", "AE1", "JH", "IH0", "K"]]],
  ],
  words: ["trick", "magic"],
  unconfirmedRhymes: serialiseUnconfirmedRhyme({
    word: "hat",
    rhymeKey: "EY T",
    writer: "judge:test-model",
    ruling: "overrule",
    confidence: "high",
  }),
});

function verdictOf(seed: string, word: string) {
  return index.adjudicate(index.pinSeed(seed), word);
}

function appeal(seed: string, word: string) {
  const verdict = appealedVerdict(verdictOf(seed, word));
  const report = { word, seedWord: seed, seedRhymeKey: index.pinSeed(seed).rhymeKey, reason: verdict };
  return { verdict, report: candidateFromReport(report, "2026-10-27T12:00:00.000Z") };
}

describe("what a player can Appeal", () => {
  it.each([
    ["a Bonus Word", "ate", "objurgate", "bonus"],
    ["a Weak Rhyme", "trick", "magic", "weak"],
    ["an Unconfirmed Rhyme", "ate", "hat", "unconfirmed"],
    ["a rejection", "bed", "hat", "does-not-rhyme"],
  ])("Appeals %s, and the capture path takes it", (_, seed, word, expected) => {
    const { verdict, report } = appeal(seed, word);

    expect(verdict).toBe(expected);
    expect(report).toMatchObject({ ok: true, candidate: { reason: expected } });
  });

  it("offers no Appeal on an Answer, and the capture path refuses one", () => {
    expect(appealedVerdict(verdictOf("ate", "late"))).toBeNull();

    const report = { word: "late", seedWord: "ate", seedRhymeKey: "EY T", reason: "answer" };
    expect(candidateFromReport(report, "2026-10-27T12:00:00.000Z").ok).toBe(false);
  });
});
