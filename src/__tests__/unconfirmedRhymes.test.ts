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
import { checkContinuity } from "../continuity.ts";
import { chooseRepresentative, curate } from "../curation.ts";
import type { ScheduleDay } from "../schedule.ts";
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

  it("gives way to a Demotion, whose reason the player receives", () => {
    // A Demotion is the editor's ruling and a line is the Judge's.
    const junk = makeTestIndex({ demotions: "hat not-a-known-word\n", unconfirmedRhymes: line({}) });
    expect(junk.adjudicate(junk.pinSeed("ate"), "hat")).toMatchObject({ reason: "not-a-known-word" });

    const name = makeTestIndex({ demotions: "hat proper-noun\n", unconfirmedRhymes: line({}) });
    expect(name.adjudicate(name.pinSeed("ate"), "hat")).toMatchObject({ reason: "proper-noun" });
  });

  it("accepts a word outside the word list that no Demotion names", () => {
    // `zate` has no wordhood and no reading: a Missing Reading the Judge
    // vouched for as a word.
    const { result } = play("ate", "zate", line({ word: "zate", ruling: "missing-reading", confidence: "medium" }));

    expect(result.verdict.outcome).toBe("unconfirmed");
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
    return buildWith("", list);
  }

  function buildWith(demotions: string, list: string) {
    return manufactureIndexData({
      cmudict: "ATE  EY1 T\nEIGHT  EY1 T\nHAT  HH AE1 T",
      words: "ate\neight\nhat",
      names: "",
      prevalence: "Word,Prevalence",
      demotions,
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

  it("drops a line whose word a Demotion names, and says so", () => {
    const { unconfirmed } = buildWith("hat not-a-known-word\n", line({}) + line({ word: "ate", rhymeKey: "AE T" }));

    expect(unconfirmed.demoted.map((entry) => entry.word)).toEqual(["hat"]);
    expect(unconfirmed.kept.map((entry) => entry.word)).toEqual(["ate"]);
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

  it("is never a Seed Word curation offers, even when its family has no other", () => {
    // `hat` is the whole of the fixture's `AE T` family.
    const sizeBand = { min: 0, max: 1000 };
    expect(curate(makeTestIndex(), { sizeBand }).candidates.map((f) => f.rhymeKey)).toContain("AE T");

    const listed = curate(makeTestIndex({ unconfirmedRhymes: line({}) }), { sizeBand });
    expect(listed.candidates.map((f) => f.rhymeKey)).not.toContain("AE T");
    expect(listed.dropped).toContainEqual({ rhymeKey: "AE T", representative: "hat", reason: "unconfirmed-rhyme" });
  });

  it("is never the word a Schedule repair swaps in", () => {
    const lost: ScheduleDay = {
      date: "2026-11-04",
      weekday: "Wed",
      week: 1,
      seed: "hatish",
      rhymeKey: "AE T",
      answerCount: 0,
      difficulty: 0,
    };
    expect(checkContinuity([lost], makeTestIndex()).days[0]!.seed).toBe("hat");

    const report = checkContinuity([lost], makeTestIndex({ unconfirmedRhymes: line({}) }));
    expect(report.days[0]!.seed).not.toBe("hat");
    expect(report.freePlay.map((d) => d.date)).toEqual(["2026-11-04"]);
  });

  it("reports nothing when no scheduled Seed Word is listed", () => {
    const list = parseUnconfirmedRhymes(line({ word: "grates" })).entries;

    expect(listedSeedWords(days, list)).toEqual([]);
  });
});
