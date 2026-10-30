/**
 * A Batch's rules (#267), as pure functions: when a Synthetic Player's run has
 * misheard its Seed Word, what is done about it, and the Trust gate's verdict
 * on a day (GLOSSARY.md, Batch; ADR-0021; #225, #252).
 */

import { describe, expect, it } from "vitest";
import {
  batchBlock,
  batchCost,
  batchesOf,
  keyCount,
  lookAttempt,
  namedBlock,
  parseBatchRecord,
  recordBatches,
  serialiseBatchRecord,
  trustFailures,
  trustVerdict,
  type BatchEntry,
} from "../batch.ts";
import type { Schedule } from "../schedule.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";

/** A tiny lexicon: each word's Rhyme Keys, as the index would read them. */
const KEYS: Record<string, string[]> = {
  bird: ["ER D"], heard: ["ER D"], word: ["ER D"], third: ["ER D"], nerd: ["ER D"], herd: ["ER D"],
  laird: ["EH R D"], cared: ["EH R D"], shared: ["EH R D"],
  read: ["IY D", "EH D"], bed: ["EH D"],
};
const keysOf = (w: string) => KEYS[w] ?? [];

describe("whether a run misheard its Seed Word", () => {
  it("counts the words on the Seed Word's own key against the most common other key", () => {
    // Sonnet on `laird`: 36 words, nearly all on /ɜrd/.
    const count = keyCount(["bird", "heard", "word", "third", "nerd", "herd", "cared"], "EH R D", keysOf);
    expect(count).toEqual({ withReading: 7, onKey: 1, topOther: { rhymeKey: "ER D", words: 6 }, offKey: true });
  });

  it("is on key at exactly five to one, since the line is more than five to one", () => {
    const count = keyCount(["bird", "heard", "word", "third", "nerd", "cared"], "EH R D", keysOf);
    expect(count.topOther).toEqual({ rhymeKey: "ER D", words: 5 });
    expect(count.offKey).toBe(false);
  });

  it("takes the ratio as a setting", () => {
    expect(keyCount(["bird", "heard", "word", "cared"], "EH R D", keysOf, 2).offKey).toBe(true);
    expect(keyCount(["bird", "heard", "word", "cared"], "EH R D", keysOf, 3).offKey).toBe(false);
  });

  it("counts a word that has the Seed Word's key as on key only, whatever else it has", () => {
    // `read` is a Rhyme for `bed`, so it is no evidence the run heard another word.
    const count = keyCount(["read", "bed"], "EH D", keysOf);
    expect(count).toEqual({ withReading: 2, onKey: 2, topOther: null, offKey: false });
  });

  it("leaves out words with no reading, which say nothing about which key was heard", () => {
    const count = keyCount(["bird", "heard", "zzyzx", "qwfp"], "ER D", keysOf);
    expect(count.withReading).toBe(2);
    expect(count.offKey).toBe(false);
  });

  it("is off key when nothing at all is on key and something else is", () => {
    expect(keyCount(["bird"], "EH R D", keysOf).offKey).toBe(true);
  });

  it("is not off key when no word has a reading, since there is no other key to have heard", () => {
    expect(keyCount([], "EH R D", keysOf)).toEqual({ withReading: 0, onKey: 0, topOther: null, offKey: false });
  });
});

describe("an off-key run is played again once", () => {
  it("keeps a run that is on key", () => {
    expect(lookAttempt([false])).toBe("keep");
  });

  it("plays an off-key run again", () => {
    expect(lookAttempt([true])).toBe("re-run");
  });

  it("keeps the re-run when it is on key", () => {
    expect(lookAttempt([true, false])).toBe("keep");
  });

  it("calls the day untested when the re-run is off key too, and plays no third time", () => {
    expect(lookAttempt([true, true])).toBe("untested");
  });

  it("has nothing to decide before a run", () => {
    expect(() => lookAttempt([])).toThrow();
  });
});

describe("the Trust gate: at most k within n looks", () => {
  const gate = { k: 1, n: 3 };

  it("never passes on the first look, which comes before any fix", () => {
    expect(trustVerdict([0], gate)).toBe("look-again");
  });

  it("passes on a look after the first that finds at most k", () => {
    expect(trustVerdict([6, 1], gate)).toBe("pass");
    expect(trustVerdict([6, 0], gate)).toBe("pass");
  });

  it("looks again while a look finds more than k and looks are left", () => {
    expect(trustVerdict([6, 2], gate)).toBe("look-again");
  });

  it("passes on the last look", () => {
    expect(trustVerdict([6, 3, 1], gate)).toBe("pass");
  });

  it("fails when the nth look still finds more than k", () => {
    expect(trustVerdict([6, 3, 2], gate)).toBe("fail");
  });

  it("takes k and n as settings", () => {
    expect(trustVerdict([6, 3], { k: 3, n: 2 })).toBe("pass");
    expect(trustVerdict([6, 4], { k: 3, n: 2 })).toBe("fail");
  });

  it("refuses n below two, which leaves no look after a fix", () => {
    expect(() => trustVerdict([0], { k: 0, n: 1 })).toThrow();
  });

  it("refuses more looks than n, which the Batch should not have played", () => {
    expect(() => trustVerdict([6, 3, 2, 0], gate)).toThrow();
  });
});

describe("the Seed Words of a Batch, from a date range", () => {
  const SEEDS = ["cup", "trick", "bed", "ate", "time", "down", "wing"];
  const schedule: Schedule = {
    startDate: "2026-11-02",
    lapStart: "2026-11-02",
    days: SEEDS.map((seed, i) => ({
      date: `2026-11-0${2 + i}`, weekday: (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const)[i]!, week: 1,
      seed, rhymeKey: `KEY ${seed}`, answerCount: 30, difficulty: 0,
    })),
  };

  it("takes the Seed Word of each date in the range, in date order", () => {
    const block = batchBlock(schedule, "2026-11-03", "2026-11-05", "2026-11-01");
    expect(block.map((d) => [d.date, d.seedWord, d.rhymeKey, d.played])).toEqual([
      ["2026-11-03", "trick", "KEY trick", false],
      ["2026-11-04", "bed", "KEY bed", false],
      ["2026-11-05", "ate", "KEY ate", false],
    ]);
  });

  it("puts the Seed Words already played last, in date order among themselves", () => {
    const block = batchBlock(schedule, "2026-11-02", "2026-11-06", "2026-11-04");
    expect(block.map((d) => d.seedWord)).toEqual(["bed", "ate", "time", "cup", "trick"]);
    expect(block.filter((d) => d.played).map((d) => d.seedWord)).toEqual(["cup", "trick"]);
  });

  it("reads a date past the listed days through the loop, as a Seed Word already played", () => {
    const block = batchBlock(schedule, "2026-11-09", "2026-11-10", "2026-11-09");
    expect(block.map((d) => [d.date, d.seedWord, d.played])).toEqual([["2026-11-09", "cup", true], ["2026-11-10", "trick", true]]);
  });

  it("names each Seed Word once, on its first date in the range", () => {
    const block = batchBlock(schedule, "2026-11-08", "2026-11-16", "2026-11-01");
    expect(block.map((d) => d.seedWord)).toEqual(["wing", "cup", "trick", "bed", "ate", "time", "down"]);
    expect(block[0]).toMatchObject({ date: "2026-11-08", seedWord: "wing" });
    expect(block[1]).toMatchObject({ date: "2026-11-09", seedWord: "cup" });
  });

  it("refuses a range that runs backwards or is not made of dates", () => {
    expect(() => batchBlock(schedule, "2026-11-05", "2026-11-03", "2026-11-01")).toThrow();
    expect(() => batchBlock(schedule, "next week", "2026-11-03", "2026-11-01")).toThrow();
  });

  it("refuses a date the Schedule does not reach, rather than leave a gap in the Batch", () => {
    expect(() => batchBlock(schedule, "2026-10-30", "2026-11-03", "2026-10-01")).toThrow(/2026-10-30/);
  });
});

describe("the Seed Words of a Batch, named rather than scheduled", () => {
  // #271 grows the Schedule from Seed Words that passed a Batch and hold no
  // place, so a Batch has to be able to take a word the Schedule does not hold.
  const index = makeTestIndex({
    pronunciations: [
      ["deer", [["D", "IH1", "R"]]],
      ["fear", [["F", "IH1", "R"]]],
      ["near", [["N", "IH1", "R"]]],
      ["peer", [["P", "IH1", "R"]]],
      ["clear", [["K", "L", "IH1", "R"]]],
    ],
    words: ["deer", "fear", "near", "peer", "clear"],
    prevalence: [["deer", 2.5], ["fear", 2.5], ["near", 2.5], ["peer", 2.5], ["clear", 2.5]],
  });

  it("plays a word with one Rhyme Key on it, with no date and as not yet played", () => {
    expect(namedBlock(["ate"], index)).toEqual([{ date: null, seedWord: "ate", rhymeKey: "EY T", played: false }]);
  });

  it("plays a word with several on the one whose family holds the most Answers, unless one is stated", () => {
    expect(index.rhymeKeysOf("tear")).toEqual(expect.arrayContaining(["IH R", "EH R"]));
    expect(namedBlock(["tear"], index)[0]!.rhymeKey).toBe("IH R");
    expect(namedBlock(["tear=EH R"], index)[0]!.rhymeKey).toBe("EH R");
  });

  it("refuses a word that does not pin, before anything is called", () => {
    expect(() => namedBlock(["zzxq"], index)).toThrow(/zzxq/);
    expect(() => namedBlock(["ate=IH R"], index)).toThrow(/ate/);
  });

  it("names each word once", () => {
    expect(namedBlock(["ate", "Ate", "ate"], index).map((s) => s.seedWord)).toEqual(["ate"]);
  });
});

describe("what a Batch costs, before any call is made", () => {
  const plan = { seeds: 3, gate: { k: 1, n: 3 }, maxJudgeCalls: 30, hunt: { rhyme: 2, wordhood: 1 } };

  it("counts the calls on each model, at fewest and at most", () => {
    expect(batchCost(plan, { player: "claude-sonnet-5-5", judge: "claude-haiku-5-5" })).toEqual([
      // Two looks at least, three at most, each played again once when off key.
      { model: "claude-sonnet-5-5", fewest: 6, most: 18, opus: false },
      // At fewest the looks need no Judge and the hunt's three calls are made;
      // at most every look takes 30 rhyme calls and a wordhood call per 20 of its 240 Candidates.
      { model: "claude-haiku-5-5", fewest: 3, most: 3 + 3 * (30 + 12), opus: false },
    ]);
  });

  it("puts both on one line when the player and the Judge are one model, and says when it is an Opus model", () => {
    expect(batchCost(plan, { player: "claude-opus-5-5", judge: "claude-opus-5-5" })).toEqual([
      { model: "claude-opus-5-5", fewest: 6 + 3, most: 18 + 3 + 3 * 42, opus: true },
    ]);
  });
});

describe("the committed record of which Seed Words have been through a Batch", () => {
  const passed: BatchEntry = {
    date: "2026-10-30", rhymeKey: "IH K", trust: "pass", failuresPerLook: [6, 1], gate: { k: 1, n: 3 },
    playerModel: "claude-sonnet-5-5", judgeModel: "claude-sonnet-5-5", report: "data/judge-runs/2026-10-30.batch.x.run-1.json",
  };
  const untested: BatchEntry = { ...passed, rhymeKey: "EH R D", trust: "untested", failuresPerLook: [] };

  it("has no Batch for any Seed Word when the file is new", () => {
    const record = parseBatchRecord(null);
    expect(batchesOf(record, "trick")).toEqual([]);
  });

  it("reads back every Batch a Seed Word has been through, by Seed Word", () => {
    let record = recordBatches(parseBatchRecord(null), [{ seedWord: "trick", entry: passed }, { seedWord: "laird", entry: untested }]);
    record = recordBatches(parseBatchRecord(serialiseBatchRecord(record)), [{ seedWord: "trick", entry: { ...passed, date: "2026-11-20", trust: "fail" } }]);
    const back = parseBatchRecord(serialiseBatchRecord(record));
    expect(batchesOf(back, "trick").map((e) => [e.date, e.trust])).toEqual([["2026-10-30", "pass"], ["2026-11-20", "fail"]]);
    expect(batchesOf(back, "laird")).toEqual([untested]);
    expect(batchesOf(back, "cup")).toEqual([]);
  });

  it("writes the Seed Words in alphabetical order, so a diff shows only the ones a Batch touched", () => {
    const record = recordBatches(parseBatchRecord(null), [{ seedWord: "trick", entry: passed }, { seedWord: "bed", entry: passed }]);
    const text = serialiseBatchRecord(record);
    expect(text.indexOf('"bed"')).toBeLessThan(text.indexOf('"trick"'));
    expect(text.endsWith("\n")).toBe(true);
    // One line per Batch, so a second Batch on a Seed Word is a one-line diff.
    expect(text.split("\n").filter((l) => l.includes('"trust"'))).toHaveLength(2);
  });

  it("refuses a file that has changed shape, rather than read a Seed Word as unchecked", () => {
    expect(() => parseBatchRecord('{"seeds": {"trick": [{"date": "2026-10-30"}]}}')).toThrow(/trick/);
    expect(() => parseBatchRecord("not json")).toThrow();
  });

  it("reads back the No False Accepts result beside the Trust one, and refuses one that does not read", () => {
    const hunted: BatchEntry = {
      ...passed,
      noFalseAccepts: { result: "fail", hunted: 6, listed: 2, unruled: ["heinz"], stillScored: [] },
    };
    const back = parseBatchRecord(serialiseBatchRecord(recordBatches(parseBatchRecord(null), [{ seedWord: "trick", entry: hunted }])));
    expect(batchesOf(back, "trick")).toEqual([hunted]);
    const broken = serialiseBatchRecord(recordBatches(parseBatchRecord(null), [{ seedWord: "trick", entry: passed }]))
      .replace('"trust":"pass"', '"trust":"pass","noFalseAccepts":{"result":"maybe"}');
    expect(() => parseBatchRecord(broken)).toThrow(/trick/);
  });
});

describe("what a look counts as a Trust failure", () => {
  it("counts a Candidate the Judge rules a Rhyme with a reading that reaches the key", () => {
    expect(trustFailures([
      { word: "snored", ruling: { verdict: "rhyme", reachesKey: true, landed: "reading" } },
      { word: "glum", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" } },
    ])).toEqual(["snored", "glum"]);
  });

  it("does not count a Rhyme whose reading misses the key, or a ruling of no Rhyme", () => {
    expect(trustFailures([
      { word: "time", ruling: { verdict: "no-rhyme", reachesKey: false, landed: "nothing" } },
      { word: "fine", ruling: { verdict: "rhyme", reachesKey: false, landed: "nothing" } },
    ])).toEqual([]);
  });

  it("does not count a Candidate the Judge was not asked about, or whose reply could not be read", () => {
    expect(trustFailures([
      { word: "objurgate" },
      { word: "mow", ruling: { verdict: "no-ruling", reachesKey: false } },
    ])).toEqual([]);
  });

  it("does not count an Unconfirmed Rhyme, which is no obvious rhyme by the maintainer's ruling on #225", () => {
    expect(trustFailures([{ word: "clique", ruling: { verdict: "rhyme", reachesKey: true, landed: "unconfirmed-rhyme" } }])).toEqual([]);
  });

  it("does not count a word the Judge finds is a name or not a word", () => {
    expect(trustFailures([{ word: "marx", ruling: { verdict: "rhyme", reachesKey: true, landed: "suggested-demotion" } }])).toEqual([]);
  });

  it("counts a Candidate ruled in an earlier look or Batch the same way, from its record", () => {
    // Ruled a Rhyme at low confidence before, so it landed nothing and is still a Candidate.
    expect(trustFailures([{ word: "fjord", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" } }])).toEqual(["fjord"]);
  });
});
