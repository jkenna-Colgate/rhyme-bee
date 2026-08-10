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
import {
  DEMOTION_REASONS,
  applyDemotions,
  parseDemotions,
  serialiseDemotion,
  type Demotion,
} from "../demotions.ts";
import { makeTestIndex, type TestInputs } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";

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

/**
 * The write half of the format, held against the read half. The Editor's Pass
 * appends to `data/demotions.txt` (#160), and a serialiser that spelled a line
 * differently from the way `parseDemotions` reads one would put a word in the
 * file that never reaches the wordhood gate — the exact defect the file exists
 * to fix, arrived at from the other end.
 */
describe("serialiseDemotion", () => {
  it.each(DEMOTION_REASONS)("round-trips a %s through the parser", (reason) => {
    const demotion: Demotion = { word: "algiers", reason };

    expect(parseDemotions(serialiseDemotion(demotion))).toEqual([demotion]);
  });

  it("terminates the line, so the next append starts one of its own", () => {
    expect(serialiseDemotion({ word: "lbs", reason: "not-a-known-word" })).toBe(
      "lbs not-a-known-word\n",
    );
  });

  it("normalises the word the way the parser does, so one spelling reaches the file", () => {
    expect(parseDemotions(serialiseDemotion({ word: "  Marx  ", reason: "proper-noun" }))).toEqual([
      { word: "marx", reason: "proper-noun" },
    ]);
  });

  it("round-trips a whole file's worth without the rows running together", () => {
    const demotions: Demotion[] = [
      { word: "heinz", reason: "proper-noun" },
      { word: "oct", reason: "not-a-known-word" },
      { word: "troy", reason: "proper-noun" },
    ];

    expect(parseDemotions(demotions.map(serialiseDemotion).join(""))).toEqual(demotions);
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

  /** The leak as pinned inputs: every one of them a word with a reading. */
  const leak: TestInputs = {
    pronunciations: [...LEAKED, ...KEPT].map(([word, pron]) => [word, [pron]]),
    words: [...LEAKED, ...KEPT].map(([word]) => word),
  };

  const demotions = LEAKED.map(([word]) => `${word} proper-noun`).join("\n");

  it("serves a leaked name as a valid rhyme until it is demoted", () => {
    // The defect itself (#51, #90), asserted so the fix cannot be mistaken for a
    // test that was always green: `kate` rhymes with `ate`, the Tutorial's Seed.
    const index = makeTestIndex(leak);

    expect(index.adjudicate(index.pinSeed("ate"), "kate").outcome).not.toBe("rejected");
  });

  it.each(LEAKED.map(([word]) => word))("rejects %s with reason proper-noun", (word) => {
    // Through the composed build, so the demotion stage runs where it really
    // runs — first, ahead of the supplement's refusal to launder a name (#106).
    const index = makeTestIndex({ ...leak, demotions });

    expect(index.adjudicate(index.pinSeed("ate"), word)).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });
  });

  it.each(KEPT.map(([word]) => word))("leaves %s alone — it is not a name", (word) => {
    const index = makeTestIndex({ ...leak, demotions });

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
