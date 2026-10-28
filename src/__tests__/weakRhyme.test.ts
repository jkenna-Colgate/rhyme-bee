/**
 * The Weak Rhyme (GLOSSARY.md, ADR-0020 as amended on #232): a word that is no
 * Rhyme, whose last syllable has the Seed Word's last syllable's rime, stressed
 * in one of the two words and unstressed in the other. It is accepted without
 * Points and shown exactly as a Bonus Word.
 *
 * The pairs below are the ones the maintainer ruled by name on #232, each in
 * both orders, since the rule holds in either. Readings are CMUdict's own, and
 * the fixture is built by the shipped build call, so every Normalisation runs
 * over them first.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";
import type { SeedWord } from "../rhymeIndex.ts";
import {
  applySubmission,
  emptyPlayState,
  missedAnswers,
  missedBonusWords,
  progress,
  rank,
  score,
  startSession,
} from "../session.ts";

const READINGS: [string, Pronunciation[]][] = [
  ["trick", [["T", "R", "IH1", "K"]]],
  ["idiotic", [["IH2", "D", "IY0", "AA1", "T", "IH0", "K"]]],
  ["makeup", [["M", "EY1", "K", "AH2", "P"]]],
  ["bishop", [["B", "IH1", "SH", "AH0", "P"]]],
  ["delusion", [["D", "IH0", "L", "UW1", "ZH", "AH0", "N"]]],
  ["sun", [["S", "AH1", "N"]]],
  ["boulder", [["B", "OW1", "L", "D", "ER0"]]],
  ["facility", [["F", "AH0", "S", "IH1", "L", "IH0", "T", "IY0"]]],
  ["tree", [["T", "R", "IY1"]]],
  ["magic", [["M", "AE1", "JH", "IH0", "K"]]],
  ["attic", [["AE1", "T", "IH0", "K"]]],
  ["academic", [["AE2", "K", "AH0", "D", "EH1", "M", "IH0", "K"]]],
  ["aspirin", [["AE1", "S", "P", "R", "IH0", "N"]]],
  ["muffin", [["M", "AH1", "F", "AH0", "N"]]],
  ["win", [["W", "IH1", "N"]]],
  ["hut", [["HH", "AH1", "T"]]],
];

const index = makeTestIndex({
  pronunciations: READINGS,
  words: READINGS.map(([word]) => word),
});

/**
 * A Seed Word by name. `delusion` and `muffin` gain a syllabic reading, so each
 * has two Rhyme Keys and is pinned to the one the dictionary wrote.
 */
function seed(word: string): SeedWord {
  const written: Record<string, string> = { delusion: "UW ZH AH N", muffin: "AH F AH N" };
  return index.pinSeed(word, written[word]);
}

function play(seedWord: string, word: string) {
  const context = startSession(index, seed(seedWord));
  const { state, result } = applySubmission(context, emptyPlayState, word);
  return { context, state, result: result! };
}

function verdictOf(seedWord: string, word: string) {
  return play(seedWord, word).result.verdict;
}

describe("a Weak Rhyme, ruled by name on #232", () => {
  it.each([
    ["trick", "idiotic"],
    ["makeup", "bishop"],
    ["trick", "magic"],
  ])("accepts %s and %s as Weak Rhymes, in either order", (a, b) => {
    expect(verdictOf(a, b).outcome).toBe("weak");
    expect(verdictOf(b, a).outcome).toBe("weak");
  });

  it.each([
    // The vowel drops: the murmured "uh" before `n` is not a said vowel.
    ["sun", "delusion"],
    // A shared vowel and no consonant after it.
    ["fur", "boulder"],
    ["tree", "facility"],
  ])("rejects %s and %s, in either order", (a, b) => {
    expect(verdictOf(a, b)).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });
    expect(verdictOf(b, a)).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });
  });

  it("rejects two words that match only on unstressed endings", () => {
    expect(verdictOf("magic", "attic")).toMatchObject({ reason: "does-not-rhyme" });
  });

  it("has no substitution property", () => {
    // Each is a Weak Rhyme for `trick`, and not for each other.
    expect(verdictOf("trick", "academic").outcome).toBe("weak");
    expect(verdictOf("magic", "academic")).toMatchObject({ reason: "does-not-rhyme" });
  });

  it("reads the weak vowel as the dictionary wrote it", () => {
    // The known fault accepted on #232: the weak-vowel Normalisation reads
    // `aspirin`'s "ih" as "uh" in a Rhyme, and a Weak Rhyme must not see that.
    expect(verdictOf("win", "aspirin").outcome).toBe("weak");
    expect(verdictOf("win", "muffin")).toMatchObject({ reason: "does-not-rhyme" });
  });

  it("accepts a full weak vowel before a consonant other than l, m or n", () => {
    expect(verdictOf("hut", "chocolate").outcome).toBe("weak");
  });
});

describe("a Weak Rhyme, played", () => {
  it("scores nothing and leaves Score and Rank where they were", () => {
    const { context, state, result } = play("trick", "magic");

    expect(result.scoreDelta).toBe(0);
    expect(result.rankChange).toBeUndefined();
    expect(score(context, state)).toBe(0);
    expect(rank(context, state)).toEqual(rank(context, emptyPlayState));
  });

  it("is counted as a Bonus Word, and a repeat is refused", () => {
    const { context, state } = play("trick", "magic");

    expect(progress(context, state)).toMatchObject({ found: 0, foundBonus: 1 });
    expect(applySubmission(context, state, "magic").result!.verdict).toMatchObject({
      reason: "already-submitted",
    });
  });

  it("is never in the Reveal", () => {
    const { context } = play("trick", "magic");

    const reveal = [...missedAnswers(context, emptyPlayState), ...missedBonusWords(context, emptyPlayState)];
    expect(reveal.map((entry) => entry.word)).not.toContain("magic");
  });
});
