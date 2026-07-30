/**
 * The committed demotion list is the human override for the *wordhood* gate
 * (ADR-0011, amended): the upstream word list carries surnames and placenames,
 * and a word it wrongly calls a word is corrected here rather than by hand in an
 * uncommitted file. A name that rhymes must be told it is a name — a silent
 * refusal reads as a bug (CONTEXT.md), and being served `algiers` as an Answer
 * reads as a worse one.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyDemotions, parseDemotions } from "../demotions.ts";
import { buildTestIndex, makeTestData } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";
import type { RhymeIndexData } from "../rhymeIndex.ts";

function target(overrides: { words?: string[]; names?: string[] } = {}) {
  return {
    words: new Set(overrides.words ?? []),
    names: new Set(overrides.names ?? []),
  };
}

describe("applyDemotions", () => {
  it("takes wordhood off a name the upstream word list holds", () => {
    const data = target({ words: ["algiers", "beard"] });
    applyDemotions("algiers proper-noun", data);

    expect(data.words.has("algiers")).toBe(false);
    expect(data.words.has("beard")).toBe(true);
  });

  it("adds the name to the names list, so the rejection reads proper-noun", () => {
    const data = target({ words: ["algiers"] });
    applyDemotions("algiers proper-noun", data);

    expect(data.names.has("algiers")).toBe(true);
  });

  it("takes wordhood off a non-word without calling it a name", () => {
    // `lbs` is junk with wordhood, not a Proper Noun: it must fail as
    // not-a-known-word, or the game claims an abbreviation is somebody's name.
    const data = target({ words: ["lbs"] });
    applyDemotions("lbs not-a-known-word", data);

    expect(data.words.has("lbs")).toBe(false);
    expect(data.names.has("lbs")).toBe(false);
  });

  it("demotes a name the upstream names list already holds", () => {
    // The leak `marx` exhibits: it is in *both* upstream lists, and the wordhood
    // gate is tested first, so being a known name never saved it.
    const data = target({ words: ["marx"], names: ["marx"] });
    applyDemotions("marx proper-noun", data);

    expect(data.words.has("marx")).toBe(false);
  });

  it("ignores blank lines and # comments", () => {
    const data = target({ words: ["heinz"] });
    applyDemotions("# a surname, not a word\n\nheinz proper-noun  # H. J. Heinz\n", data);

    expect(data.words.has("heinz")).toBe(false);
    expect(data.names.has("#")).toBe(false);
  });

  it("refuses an unrecognised reason rather than silently doing nothing", () => {
    expect(() => parseDemotions("heinz name")).toThrow(/heinz/);
  });

  it("refuses a line with no reason, so a bare word list cannot creep in", () => {
    expect(() => parseDemotions("heinz")).toThrow(/heinz/);
  });

  it("reports an entry the upstream list no longer holds, so the file can be pruned", () => {
    const data = target({ words: ["heinz"] });
    const applied = applyDemotions("heinz proper-noun\nzzyzx proper-noun", data);

    expect(applied.find((e) => e.word === "heinz")?.hadWordhood).toBe(true);
    expect(applied.find((e) => e.word === "zzyzx")?.hadWordhood).toBe(false);
  });
});

describe("a demoted index adjudicates", () => {
  /** The upstream leak, reproduced: names carrying wordhood and a reading. */
  const LEAKED: [string, Pronunciation][] = [
    ["kate", ["K", "EY1", "T"]],
    ["heinz", ["HH", "AY1", "N", "Z"]],
    ["algiers", ["AE0", "L", "JH", "IH1", "R", "Z"]],
    ["marx", ["M", "AA1", "R", "K", "S"]],
    ["troy", ["T", "R", "OY1"]],
  ];

  /** Not names: foreign forms and interjections that must keep their wordhood. */
  const KEPT: [string, Pronunciation][] = [
    ["zounds", ["Z", "AW1", "N", "D", "Z"]],
    ["congrats", ["K", "AH0", "N", "G", "R", "AE1", "T", "S"]],
  ];

  function leakedData(): RhymeIndexData {
    const data = makeTestData();
    for (const [word, pron] of [...LEAKED, ...KEPT]) {
      data.pronunciations.set(word, [pron]);
      data.words.add(word);
    }
    return data;
  }

  const demotions = LEAKED.map(([word]) => `${word} proper-noun`).join("\n");

  it("serves a leaked name as a valid rhyme until it is demoted", () => {
    // The defect itself (#51, #90), asserted so the fix cannot be mistaken for a
    // test that was always green: `kate` rhymes with `ate`, the Tutorial's Seed.
    const index = buildTestIndex(leakedData());

    expect(index.adjudicate(index.pinSeed("ate"), "kate").outcome).not.toBe("rejected");
  });

  it.each(LEAKED.map(([word]) => word))("rejects %s with reason proper-noun", (word) => {
    const data = leakedData();
    applyDemotions(demotions, data);
    const index = buildTestIndex(data);

    expect(index.adjudicate(index.pinSeed("ate"), word)).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });
  });

  it.each(KEPT.map(([word]) => word))("leaves %s alone — it is not a name", (word) => {
    const data = leakedData();
    applyDemotions(demotions, data);
    const index = buildTestIndex(data);

    expect(index.hasWord(word)).toBe(true);
  });
});

describe("the committed demotion list", () => {
  const text = readFileSync(
    fileURLToPath(new URL("../../data/demotions.txt", import.meta.url)),
    "utf8",
  );
  const entries = parseDemotions(text);

  it("parses, and every entry carries a rejection reason", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("lists each word once", () => {
    const words = entries.map((e) => e.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it.each(["kate", "troy", "heinz", "algiers", "marx"])("holds %s", (word) => {
    expect(entries.find((e) => e.word === word)?.reason).toBe("proper-noun");
  });
});
