/**
 * The Unconfirmed Rhyme list (#259): a word the Judge ruled a Rhyme on one
 * Rhyme Key, accepted there without Points until the Editor's Pass confirms or
 * Declines it (GLOSSARY.md, ADR-0017 amended).
 *
 * Played through the session over a fixture built by the shipped build call, so
 * every case asserts what a player would see: the verdict, the Points, the
 * Score, and the Reveal.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { chooseRepresentative } from "../curation.ts";
import { manufactureIndexData } from "../manufacture.ts";
import { deserialise, serialise } from "../serialise.ts";
import {
  applySubmission,
  emptyPlayState,
  missedAnswers,
  missedBonusWords,
  progress,
  score,
  startSession,
} from "../session.ts";
import {
  listedSeedWords,
  parseUnconfirmedRhymes,
  serialiseUnconfirmedRhyme,
  type UnconfirmedRhyme,
} from "../unconfirmedRhymes.ts";

function line(over: Partial<UnconfirmedRhyme>): string {
  return serialiseUnconfirmedRhyme({
    word: "hat",
    rhymeKey: "EY T",
    writer: "judge:test-model",
    ruling: "overrule",
    confidence: "high",
    ...over,
  });
}

function play(seed: string, word: string, list: string) {
  const context = startSession(makeTestIndex({ unconfirmedRhymes: list }), seed);
  const { state, result } = applySubmission(context, emptyPlayState, word);
  return { context, state, result: result! };
}

describe("an Unconfirmed Rhyme, played", () => {
  it("is accepted without Points on its Rhyme Key, counted as a Bonus Word", () => {
    // `hat` is /AE T/: the engine holds a reading that misses `ate`'s key, so
    // this is the Overrule shape.
    const { context, state, result } = play("ate", "hat", line({}));

    expect(result.verdict.outcome).toBe("unconfirmed");
    expect(result.scoreDelta).toBe(0);
    expect(score(context, state)).toBe(0);
    expect(progress(context, state)).toMatchObject({ found: 0, foundBonus: 1 });
  });

  it("is rejected as today on another Rhyme Key", () => {
    // `hat` listed for `ate` is nothing for `bed`.
    const { result } = play("bed", "hat", line({}));

    expect(result.verdict).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });
  });

  it("holds on every day its Rhyme Key is played, whichever word is the Seed Word", () => {
    expect(play("late", "hat", line({})).result.verdict.outcome).toBe("unconfirmed");
  });

  it("accepts a word the game holds no reading for, the Missing Reading shape", () => {
    // `grates` has wordhood and no reading, so today it is not a known word.
    expect(play("ate", "grates", "").result.verdict).toMatchObject({ reason: "not-a-known-word" });

    const listed = play("ate", "grates", line({ word: "grates", ruling: "missing-reading", confidence: "medium" }));
    expect(listed.result.verdict.outcome).toBe("unconfirmed");
  });

  it("never makes a name acceptable", () => {
    const { result } = play("ate", "kate", line({ word: "kate", ruling: "missing-reading" }));

    expect(result.verdict).toMatchObject({ outcome: "rejected", reason: "proper-noun" });
  });

  it("leaves a word that rhymes on its key by itself with its own Tier", () => {
    const { result } = play("ate", "eight", line({ word: "eight" }));

    expect(result.verdict.outcome).toBe("answer");
  });

  it("is never in the Reveal", () => {
    const { context } = play("ate", "late", line({}));

    const reveal = [...missedAnswers(context, emptyPlayState), ...missedBonusWords(context, emptyPlayState)];
    const words = reveal.map((entry) => entry.word);
    expect(words).not.toContain("hat");
    expect(words).toContain("eight");
  });
});

describe("the Unconfirmed Rhyme list, at index build", () => {
  function build(list: string) {
    return manufactureIndexData({
      cmudict: "ATE  EY1 T\nEIGHT  EY1 T\nHAT  HH AE1 T",
      words: "ate\neight\nhat",
      names: "",
      prevalence: "Word,Prevalence",
      demotions: "",
      supplement: "",
      tierOverrides: "",
      unconfirmedRhymes: list,
    });
  }

  it("drops a line whose word now rhymes on its key by itself, and says so", () => {
    // Confirming a line is the ordinary add, which gives `eight` the reading
    // that reaches the key; the line is then stale.
    const { data, unconfirmed } = build(line({}) + line({ word: "eight" }));

    expect(unconfirmed.stale.map((entry) => entry.word)).toEqual(["eight"]);
    expect(unconfirmed.kept.map((entry) => entry.word)).toEqual(["hat"]);
    expect([...(data.unconfirmedRhymes ?? new Map()).keys()]).toEqual(["hat"]);
  });

  it("drops a line that does not read, and names it", () => {
    const { unconfirmed } = build("hat judge:test-model guessed high EY T\n" + line({}));

    expect(unconfirmed.malformed).toEqual(["hat judge:test-model guessed high EY T"]);
    expect(unconfirmed.kept.map((entry) => entry.word)).toEqual(["hat"]);
  });

  it("reaches the player's browser through the served artifact", () => {
    const { data } = build(line({}));
    const index = deserialise(JSON.parse(JSON.stringify(serialise(data, { knownnessThreshold: 0 }, {}))));

    expect(index.adjudicate(index.pinSeed("ate"), "hat").outcome).toBe("unconfirmed");
  });
});

describe("Seed Words and Unconfirmed Rhymes, kept apart", () => {
  const days = [
    { date: "2026-11-02", seed: "hat", rhymeKey: "AE T" },
    { date: "2026-11-03", seed: "ate", rhymeKey: "EY T" },
  ];

  it("reports a scheduled Seed Word the list holds, on whatever key it is listed for", () => {
    const list = parseUnconfirmedRhymes(line({ word: "hat", rhymeKey: "EY T" })).entries;

    expect(listedSeedWords(days, list)).toEqual([
      { date: "2026-11-02", seed: "hat", listedFor: ["EY T"] },
    ]);
  });

  it("is never the word curation picks to stand for a family", () => {
    const family = ["ate", "eight", "late"];
    expect(chooseRepresentative(family, makeTestIndex())).toBe("ate");

    // `ate` listed for `hat`'s key loses its family's Seed Word to the next best.
    const listed = makeTestIndex({ unconfirmedRhymes: line({ word: "ate", rhymeKey: "AE T" }) });
    expect(chooseRepresentative(family, listed)).toBe("late");
  });

  it("reports nothing when no scheduled Seed Word is listed", () => {
    const list = parseUnconfirmedRhymes(line({ word: "grates" })).entries;

    expect(listedSeedWords(days, list)).toEqual([]);
  });
});
