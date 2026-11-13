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
  judgeCallCap,
  keyCount,
  lookAttempt,
  namedBlock,
  parseBatchRecord,
  recordBatches,
  serialiseBatchRecord,
  trustFailures,
  trustVerdict,
  undecidedRhymes,
  untieredWrittenIn,
  writtenInAnswers,
  type BatchEntry,
} from "../batch.ts";
import type { JudgeRulingRecord } from "../judgeLanding.ts";
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
      // At fewest the looks need no Judge, write nothing in, and the hunt's three calls are made;
      // at most every look takes 30 rhyme calls and a wordhood call per 20 of its 240 Candidates,
      // and the Tier question, asked once after the looks, takes a call per 20 of all 720,
      // should every one be written in with no knownness.
      { model: "claude-haiku-5-5", fewest: 3, most: 3 + 3 * (30 + 12) + 36, opus: false },
    ]);
  });

  it("puts both on one line when the player and the Judge are one model, and says when it is an Opus model", () => {
    expect(batchCost(plan, { player: "claude-opus-5-5", judge: "claude-opus-5-5" })).toEqual([
      { model: "claude-opus-5-5", fewest: 6 + 3, most: 18 + 3 + 3 * 42 + 36, opus: true },
    ]);
  });

  it("caps the Judge at two rhyme calls a look per Seed Word when no cap is given", () => {
    // A Batch of 30 needed 36 calls on its first look and was stopped by a cap of 30.
    expect(judgeCallCap({ seeds: 30 })).toBe(60);
    const { maxJudgeCalls: _, ...uncapped } = plan;
    expect(judgeCallCap(uncapped)).toBe(6);
    // Three looks of 6 rhyme calls and a wordhood call per 20 of each look's 48 Candidates,
    // then one Tier question over all 144: 8 calls, where asking it every look would count 9.
    expect(batchCost(uncapped, { player: "claude-sonnet-5-5", judge: "claude-haiku-5-5" })[1]).toEqual(
      { model: "claude-haiku-5-5", fewest: 3, most: 3 + 3 * (6 + 3) + 8, opus: false },
    );
  });

  it("lets a cap that is given override the default", () => {
    expect(judgeCallCap({ seeds: 30, maxJudgeCalls: 45 })).toBe(45);
    expect(judgeCallCap(plan)).toBe(30);
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
  /** The Answer line: a knownness at or above it makes an Answer. */
  const LINE = 0.5;
  const failures = (candidates: Parameters<typeof trustFailures>[0]) => trustFailures(candidates, LINE).failures;

  it("counts a Candidate the Judge rules a Rhyme with a reading that reaches the key", () => {
    expect(failures([
      { word: "snored", ruling: { verdict: "rhyme", reachesKey: true, landed: "reading" } },
      { word: "glum", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" } },
    ])).toEqual(["snored", "glum"]);
  });

  it("does not count a Rhyme whose reading misses the key, or a ruling of no Rhyme", () => {
    expect(failures([
      { word: "time", ruling: { verdict: "no-rhyme", reachesKey: false, landed: "nothing" } },
      { word: "fine", ruling: { verdict: "rhyme", reachesKey: false, landed: "nothing" } },
    ])).toEqual([]);
  });

  it("does not count a Candidate the Judge was not asked about, or whose reply could not be read", () => {
    expect(failures([
      { word: "objurgate" },
      { word: "mow", ruling: { verdict: "no-ruling", reachesKey: false } },
    ])).toEqual([]);
  });

  it("does not count an Unconfirmed Rhyme, which is no obvious rhyme by the maintainer's ruling on #225", () => {
    expect(failures([{ word: "clique", ruling: { verdict: "rhyme", reachesKey: true, landed: "unconfirmed-rhyme" } }])).toEqual([]);
  });

  it("does not count a word the Judge finds is a name or not a word", () => {
    expect(failures([{ word: "marx", ruling: { verdict: "rhyme", reachesKey: true, landed: "suggested-demotion" } }])).toEqual([]);
  });

  it("counts a Candidate ruled in an earlier look or Batch the same way, from its record", () => {
    // Ruled a Rhyme at low confidence before, so it landed nothing and is still a Candidate.
    expect(failures([{ word: "fjord", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" } }])).toEqual(["fjord"]);
  });

  it("excuses a Rhyme the game accepts as a Bonus Word whose knownness measures it as rare, and says so", () => {
    // `hod` for `nod`: the game is right not to score it, which is its Tier's question and not Trust's.
    expect(trustFailures([
      { word: "hod", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "bonus", knownness: 0.2, byVerdict: false } },
      { word: "snored", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "rejected" } },
    ], LINE)).toEqual({ failures: ["snored"], excused: ["hod"] });
  });

  it("counts a Rhyme the game accepts as a Bonus Word with no knownness, which is how a common word ends up one by accident", () => {
    // `fool` for `cool`, missing from the prevalence data.
    expect(trustFailures([
      { word: "fool", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "bonus", knownness: null, byVerdict: false } },
    ], LINE)).toEqual({ failures: ["fool"], excused: [] });
  });

  it("excuses a Rhyme the game accepts as a Bonus Word by an editor's Tier verdict, and says so", () => {
    // `guardianship` for `ship`: the editor has judged players would not come up with it, whatever its knownness.
    expect(trustFailures([
      { word: "guardianship", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "bonus", knownness: 0.9, byVerdict: true } },
      { word: "snored", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "rejected" } },
    ], LINE)).toEqual({ failures: ["snored"], excused: ["guardianship"] });
  });

  it("excuses a Bonus Word with no knownness when an editor's Tier verdict put it there", () => {
    expect(trustFailures([
      { word: "meathook", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "bonus", knownness: null, byVerdict: true } },
    ], LINE)).toEqual({ failures: [], excused: ["meathook"] });
  });

  it("counts a Rhyme the look fixed into an Answer, in that look", () => {
    // `nightgown` for `down`: it had no reading, one was written in, and the rebuild made it an Answer.
    expect(trustFailures([
      { word: "nightgown", ruling: { verdict: "rhyme", reachesKey: true, landed: "reading" }, game: { outcome: "answer" } },
    ], LINE)).toEqual({ failures: ["nightgown"], excused: [] });
  });

  it("counts a Bonus Word whose knownness is at the Answer line, which the game could only have Tiered by mistake", () => {
    expect(trustFailures([
      { word: "lard", ruling: { verdict: "rhyme", reachesKey: true, landed: "nothing" }, game: { outcome: "bonus", knownness: LINE, byVerdict: false } },
    ], LINE)).toEqual({ failures: ["lard"], excused: [] });
  });

  it("excuses nothing that was never a failure: a rare Bonus Word ruled no Rhyme, an Unconfirmed Rhyme, a Demotion", () => {
    expect(trustFailures([
      { word: "pard", ruling: { verdict: "no-rhyme", reachesKey: false, landed: "nothing" }, game: { outcome: "bonus", knownness: 0.1, byVerdict: false } },
      { word: "clique", ruling: { verdict: "rhyme", reachesKey: true, landed: "unconfirmed-rhyme" }, game: { outcome: "unconfirmed" } },
      { word: "marx", ruling: { verdict: "rhyme", reachesKey: true, landed: "suggested-demotion" }, game: { outcome: "bonus", knownness: 0.1, byVerdict: false } },
    ], LINE)).toEqual({ failures: [], excused: [] });
  });
});

describe("the Judge's undecided rhymes, put to the maintainer in the sitting", () => {
  /** A ruling as `data/judge-rulings.jsonl` records it, with what a test does not care about filled in. */
  const ruling = (r: Partial<JudgeRulingRecord> & Pick<JudgeRulingRecord, "word" | "seedWord" | "rhymeKey">): JudgeRulingRecord => ({
    date: "2026-11-01", model: "claude-sonnet-5-5", knew: "overrule", verdict: "rhyme",
    reading: null, confidence: "medium", why: "rhymes", landed: "nothing", ...r,
  });
  const house = ruling({ word: "house", seedWord: "arouse", rhymeKey: "AW Z", reading: "HH AW1 Z", why: "the verb, /haʊz/" });

  it("lists every Rhyme ruling that landed nothing, whatever its confidence, with what the maintainer is shown", () => {
    const barbar = ruling({ word: "barbar", seedWord: "guitar", rhymeKey: "AA R", knew: "missing-reading", confidence: "low", reading: "B AA1 R B AA2 R" });
    // A high-confidence Overrule held back because the word is a scheduled Seed Word landed nothing too.
    const heldBack = ruling({ word: "cause", seedWord: "bras", rhymeKey: "AA Z", confidence: "high", reading: "K AA1 Z", heldBack: "scheduled-seed-word" });
    expect(undecidedRhymes([house, barbar, heldBack])).toEqual([
      { word: "house", seedWord: "arouse", rhymeKey: "AW Z", knew: "overrule", confidence: "medium", heard: "HH AW1 Z", reading: ["HH", "AW1", "Z"], why: "the verb, /haʊz/" },
      { word: "barbar", seedWord: "guitar", rhymeKey: "AA R", knew: "missing-reading", confidence: "low", heard: "B AA1 R B AA2 R", reading: ["B", "AA1", "R", "B", "AA2", "R"], why: "rhymes" },
      { word: "cause", seedWord: "bras", rhymeKey: "AA Z", knew: "overrule", confidence: "high", heard: "K AA1 Z", reading: ["K", "AA1", "Z"], why: "rhymes" },
    ]);
  });

  it("lists none that landed anything, and no ruling of no Rhyme", () => {
    expect(undecidedRhymes([
      ruling({ word: "nightgown", seedWord: "down", rhymeKey: "AW N", confidence: "high", reading: "N AY1 T G AW2 N", landed: "reading" }),
      ruling({ word: "clique", seedWord: "trick", rhymeKey: "IH K", confidence: "high", reading: "K L IH1 K", landed: "unconfirmed-rhyme" }),
      ruling({ word: "marx", seedWord: "parks", rhymeKey: "AA R K S", confidence: "high", reading: "M AA1 R K S", landed: "suggested-demotion" }),
      ruling({ word: "time", seedWord: "fine", rhymeKey: "AY N", verdict: "no-rhyme", confidence: "high", reading: "T AY1 M" }),
    ])).toEqual([]);
  });

  it("lists a pair once, though looks and Batches before met it, and a word again on another Rhyme Key", () => {
    const houseOnAws = ruling({ word: "house", seedWord: "mouse", rhymeKey: "AW S", reading: "HH AW1 S" });
    expect(undecidedRhymes([house, house, houseOnAws]).map((u) => `${u.word} ${u.rhymeKey}`)).toEqual(["house AW Z", "house AW S"]);
  });

  it("lists no pair the editor has Declined, since a Decline is a ruling already made", () => {
    const douse = ruling({ word: "douse", seedWord: "arouse", rhymeKey: "AW Z", reading: "D AW1 Z" });
    expect(undecidedRhymes([house, douse], [{ word: "house", rhymeKey: "AW Z" }]).map((u) => u.word)).toEqual(["douse"]);
  });

  it("offers no reading to confirm when the Judge's misses the key or does not read as ARPAbet", () => {
    const listed = undecidedRhymes([
      ruling({ word: "fine", seedWord: "time", rhymeKey: "AY M", reading: "F AY1 N" }),
      ruling({ word: "glum", seedWord: "home", rhymeKey: "OW M", reading: "/ɡlʌm/" }),
      ruling({ word: "mum", seedWord: "home", rhymeKey: "OW M", reading: null }),
    ]);
    expect(listed.map((u) => [u.word, u.heard, u.reading])).toEqual([["fine", "F AY1 N", null], ["glum", "/ɡlʌm/", null], ["mum", null, null]]);
  });
});

describe("the written-in words with no knownness, put to the maintainer to Tier", () => {
  const landed = (word: string, seedWord: string, rhymeKey: string, l: JudgeRulingRecord["landed"] = "reading"): JudgeRulingRecord => ({
    date: "2026-11-01", model: "claude-sonnet-5-5", word, seedWord, rhymeKey, knew: "missing-reading", verdict: "rhyme",
    reading: null, confidence: "high", why: "rhymes", landed: l,
  });
  /** Knownness as the index gives it: `nightgown` and `takedown` have a value, the rest none. */
  const KNOWNNESS: Record<string, number> = { nightgown: 1.4, takedown: -0.8 };
  const knownness = (word: string) => KNOWNNESS[word] ?? null;

  it("lists each word the Batch wrote a reading for that has no knownness, with the Rhyme Key it was found on", () => {
    expect(untieredWrittenIn([
      landed("throwdown", "down", "AW N"),
      landed("nightgown", "down", "AW N"),
      landed("hotrod", "god", "AA D"),
      landed("takedown", "down", "AW N"),
    ], knownness)).toEqual([
      { word: "throwdown", seedWord: "down", rhymeKey: "AW N" },
      { word: "hotrod", seedWord: "god", rhymeKey: "AA D" },
    ]);
  });

  it("lists a word once, though several looks or keys wrote it in", () => {
    expect(untieredWrittenIn([
      landed("meathook", "book", "UH K"),
      landed("meathook", "book", "UH K"),
      landed("meathook", "crook", "UH K"),
    ], knownness)).toEqual([{ word: "meathook", seedWord: "book", rhymeKey: "UH K" }]);
  });

  it("lists no word whose ruling wrote no reading", () => {
    expect(untieredWrittenIn([
      landed("clique", "trick", "IH K", "unconfirmed-rhyme"),
      landed("marx", "parks", "AA R K S", "suggested-demotion"),
      landed("barbar", "guitar", "AA R", "nothing"),
    ], knownness)).toEqual([]);
  });
});

describe("the written-in words that score, put to the maintainer to keep or make Bonus Words (#319)", () => {
  const landed = (word: string, seedWord: string, rhymeKey: string, l: JudgeRulingRecord["landed"] = "reading"): JudgeRulingRecord => ({
    date: "2026-11-12", model: "claude-sonnet-5-5", word, seedWord, rhymeKey, knew: "missing-reading", verdict: "rhyme",
    reading: null, confidence: "high", why: "rhymes", landed: l,
  });
  /** The Answer line is 0.5: `afterschool` and `meringue` are above it, `creased` on it, `retool` below, `throwdown` has none. */
  const KNOWNNESS: Record<string, number> = { afterschool: 1.33, meringue: 2.1, creased: 0.5, retool: 0.2 };
  const knownness = (word: string) => KNOWNNESS[word] ?? null;

  it("lists each written-in word at or above the Answer line, with its knownness and the Rhyme Key it was found on", () => {
    expect(writtenInAnswers([
      landed("afterschool", "cool", "UW L"),
      landed("throwdown", "down", "AW N"),
      landed("retool", "cool", "UW L"),
      landed("creased", "feast", "IY S T"),
    ], knownness, 0.5)).toEqual([
      { word: "afterschool", seedWord: "cool", rhymeKey: "UW L", knownness: 1.33 },
      { word: "creased", seedWord: "feast", rhymeKey: "IY S T", knownness: 0.5 },
    ]);
  });

  it("groups the words by Seed Word, each Seed Word where its first word came", () => {
    expect(writtenInAnswers([
      landed("afterschool", "cool", "UW L"),
      landed("creased", "feast", "IY S T"),
      landed("meringue", "cool", "UW L"),
    ], knownness, 0.5).map((w) => w.word)).toEqual(["afterschool", "meringue", "creased"]);
  });

  it("lists a word once, and none whose ruling wrote no reading", () => {
    expect(writtenInAnswers([
      landed("afterschool", "cool", "UW L"),
      landed("afterschool", "school", "UW L"),
      landed("meringue", "cool", "UW L", "unconfirmed-rhyme"),
    ], knownness, 0.5).map((w) => [w.word, w.seedWord])).toEqual([["afterschool", "cool"]]);
  });
});
