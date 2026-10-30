/**
 * The Seed Word test (#264): a word can be a Seed Word only if it is heard one
 * way, is an Answer, and is not an Unconfirmed Rhyme. Asserted over the mini
 * fixture index, whose `tear` is the homograph GLOSSARY.md names.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { chooseRepresentative } from "../curation.ts";
import { checkScheduledSeedWords, seedWordCheckLines, seedWordChecksAfterWrite, seedWordFor, testSeedWord } from "../seedWord.ts";
import { serialiseUnconfirmedRhyme } from "../unconfirmedRhymes.ts";

const index = makeTestIndex();

describe("a Seed Word is heard one way", () => {
  it("passes a word with one Rhyme Key", () => {
    expect(testSeedWord(index, "ate", "EY T")).toEqual({ passes: true });
  });

  it("fails a word whose other reading rhymes with a word its pinned reading does not", () => {
    // Pinned to `IH R`, `tear` is the one in your eye; the player who hears
    // the other `tear` hunts for `care`, which the day rejects.
    const test = testSeedWord(index, "tear", "IH R");
    expect(test).toMatchObject({ passes: false, reason: "not-heard-one-way" });
    expect(test.passes === false && test.reason === "not-heard-one-way" && test.strays).toEqual([
      { rhymeKey: "EH R", words: ["care", "hair"] },
    ]);
  });

  it("passes a twin-key word whose two Rhyme Keys hold the same words", () => {
    // `fiction` said with and without the schwa before its final n: two Rhyme
    // Keys, one family, so nobody hunting either way is turned away.
    const twins = makeTestIndex({
      pronunciations: [
        ["fiction", [["F", "IH1", "K", "SH", "AH0", "N"], ["F", "IH1", "K", "SH", "N"]]],
        ["diction", [["D", "IH1", "K", "SH", "AH0", "N"]]],
        ["friction", [["F", "R", "IH1", "K", "SH", "N"]]],
      ],
      words: ["fiction", "diction", "friction"],
      prevalence: [["fiction", 2.5], ["diction", 2.0], ["friction", 2.2]],
    });
    expect(twins.isAmbiguous("fiction")).toBe(true);
    expect(testSeedWord(twins, "fiction", "IH K SH AH N")).toEqual({ passes: true });
  });

  it("passes a word whose other reading rhymes with nothing the pinned one misses", () => {
    // A second reading whose family is the word alone takes no rhyme away.
    const lone = makeTestIndex({
      pronunciations: [["hat", [["HH", "AE1", "T"], ["HH", "OY1", "ZH"]]]],
    });
    expect(lone.isAmbiguous("hat")).toBe(true);
    expect(testSeedWord(lone, "hat", "AE T")).toEqual({ passes: true });
  });
});

describe("a Seed Word is an Answer", () => {
  it("fails a Bonus Word, which almost nobody knows", () => {
    expect(testSeedWord(index, "objurgate", "EY T")).toMatchObject({ passes: false, reason: "not-an-answer" });
  });

  it("fails a word with no knownness at all", () => {
    // `sate` is absent from the prevalence data, so it defaults to Bonus.
    expect(testSeedWord(index, "sate", "EY T")).toMatchObject({ passes: false, reason: "not-an-answer" });
  });
});

describe("a Seed Word is not an Unconfirmed Rhyme", () => {
  it("fails a word listed as one on any Rhyme Key", () => {
    const listed = makeTestIndex({
      unconfirmedRhymes: serialiseUnconfirmedRhyme({
        word: "late",
        rhymeKey: "AE T",
        writer: "judge:test-model",
        ruling: "overrule",
        confidence: "high",
      }),
    });
    expect(testSeedWord(listed, "late", "EY T")).toMatchObject({ passes: false, reason: "unconfirmed-rhyme" });
  });
});

describe("the family's Seed Word is its best-ranked word that passes", () => {
  it("passes over a word that fails, to the next one the ranking holds", () => {
    // `sate` carries `EY T` on its main stress, which ranks it above
    // `impregnate`, but nobody's knownness vouches for it.
    const words = ["impregnate", "sate"];
    expect(chooseRepresentative(words, index, "EY T")).toBe("sate");
    expect(seedWordFor(words, index, "EY T")).toBe("impregnate");
  });

  it("is null when no word of the family passes", () => {
    expect(seedWordFor(["tear"], index, "EH R")).toBeNull();
  });
});

describe("the test on a word the Editor's Pass gave a reading", () => {
  const days = [
    { date: "2026-09-07", weekday: "Mon" as const, week: 1, seed: "tear", rhymeKey: "IH R", answerCount: 1, difficulty: 0 },
    { date: "2026-09-08", weekday: "Tue" as const, week: 1, seed: "ate", rhymeKey: "EY T", answerCount: 7, difficulty: 0 },
  ];

  it("tests every scheduled day whose Seed Word is among the words, and names the word its day would go to", () => {
    expect(checkScheduledSeedWords(days, index, ["Tear", "hair"])).toEqual([
      {
        date: "2026-09-07",
        seed: "tear",
        rhymeKey: "IH R",
        passes: false,
        line: expect.stringContaining("tear is not heard one way: on EH R it rhymes with 2 word(s)"),
        next: "beer",
      },
    ]);
  });

  it("says a Seed Word that still passes passes, with nowhere to go", () => {
    expect(checkScheduledSeedWords(days, index, ["ate"])).toEqual([
      { date: "2026-09-08", seed: "ate", rhymeKey: "EY T", passes: true, line: "ate passes the Seed Word test on EY T.", next: null },
    ]);
  });

  it("opens no index for a write to no Seed Word, and gives no verdict off an index the rebuild did not write", () => {
    const opened: string[] = [];
    const open = () => {
      opened.push("index");
      return index;
    };
    expect(seedWordChecksAfterWrite(days, ["hair"], true, open)).toEqual([]);
    expect(seedWordChecksAfterWrite(days, ["tear"], false, open)).toBeNull();
    expect(opened).toEqual([]);
    expect(seedWordChecksAfterWrite(days, ["tear"], true, open)).toHaveLength(1);
  });

  it("says in a line where a failing day would go and the command that writes it", () => {
    const [line] = seedWordCheckLines(checkScheduledSeedWords(days, index, ["tear"]));
    expect(line).toMatch(/^2026-09-07, Seed Word tear: tear is not heard one way/);
    expect(line).toContain("The day would keep IH R and go to beer. Run npm run seeds:test -- --write to write it.");
  });
});
