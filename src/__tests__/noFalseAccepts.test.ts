/**
 * The No False Accepts half of a Batch (#268), as pure functions: which scored
 * Answers the hunt puts to the Judge, which of the Judge's rulings go on the
 * maintainer's ruling list, and the gate's verdict once the maintainer has
 * ruled (GLOSSARY.md, Playability Bar; #225, #242). How a typed ruling is read
 * is tested in `rulingList.test.ts`.
 */

import { describe, expect, it } from "vitest";
import type { RhymeRuling, WordhoodRuling } from "../judge.ts";
import {
  huntAnswers,
  huntListing,
  noFalseAcceptsResult,
  rulingList,
  type AppendedGroup,
  type HuntedAnswer,
  type HuntReason,
  type HuntRuling,
} from "../noFalseAccepts.ts";
import type { MarkedReading } from "../appendedReadings.ts";
import type { Pronunciation } from "../phonology.ts";

const r = (s: string): Pronunciation => s.split(" ");

/** Each word's Wiktionary readings, already normalised as the index would hold them. */
const WIKTIONARY: Record<string, Pronunciation[]> = {
  freight: [r("F R EY1 T")],
  chocolate: [r("CH AA1 K L AH0 T")],
  candidate: [r("K AE1 N D AH0 D EY2 T"), r("K AE1 N D AH0 D AH0 T")],
  kate: [r("K EY1 T")],
  // A schwa-ful reading that is the key's Schwa Twin reaches it (`trial` for `file`).
  trial: [r("T R AY1 AH0 L")],
};
const NAMES = new Set(["kate", "grace", "chocolate"]);
/** The game's readings, each marked if Normalisation appended it. */
const source = (s: string): MarkedReading => ({ pronunciation: r(s), generated: false });
const appended = (s: string): MarkedReading => ({ pronunciation: r(s), generated: true });
const facts = {
  wiktionaryReadings: (w: string) => WIKTIONARY[w] ?? [],
  isName: (w: string) => NAMES.has(w),
  readingsOf: (): MarkedReading[] => [],
};

describe("which scored Answers the hunt puts to the Judge", () => {
  it("sends an Answer none of whose Wiktionary readings has the Seed Word's Rhyme Key", () => {
    const hunted = huntAnswers(["freight", "chocolate", "candidate", "late"], "EY T", facts);
    expect(hunted).toEqual([
      { word: "chocolate", reasons: ["another-key", "names-hit"], wiktionaryKeys: ["AA K L AH T"] },
    ]);
  });

  it("leaves an Answer one of whose readings agrees, though another does not: one way that fits is enough", () => {
    expect(huntAnswers(["candidate"], "EY T", facts)).toEqual([]);
  });

  it("leaves an Answer Wiktionary has no reading for, unless the names data holds it", () => {
    expect(huntAnswers(["late", "grace"], "EY T", facts)).toEqual([
      { word: "grace", reasons: ["names-hit"], wiktionaryKeys: [] },
    ]);
  });

  it("sends a names hit whose reading agrees, because a hit is only a reason to ask", () => {
    expect(huntAnswers(["kate"], "EY T", facts)).toEqual([{ word: "kate", reasons: ["names-hit"], wiktionaryKeys: ["EY T"] }]);
  });

  it("counts a reading on the key's Schwa Twin as on the key", () => {
    expect(huntAnswers(["trial"], "AY L", facts)).toEqual([]);
  });

  describe("an Answer only Normalisation puts on the key (#297)", () => {
    // `event` /EH N T/: stress promotion appends a stressed final syllable to `comment` and `vestment`.
    const WIKT: Record<string, Pronunciation[]> = { comment: [r("K AA1 M EH2 N T")], vestment: [r("V EH1 S T M AH0 N T")] };
    const GAME: Record<string, MarkedReading[]> = {
      vestment: [source("V EH1 S T M AH0 N T"), appended("V EH1 S T M EH2 N T")],
      comment: [source("K AA1 M EH0 N T"), appended("K AA1 M EH2 N T")],
      lament: [source("L AH0 M EH1 N T")],
      // A reading a source transcribed reaches the key beside the appended one.
      segment: [source("S EH1 G M EH2 N T"), appended("S EH1 G M EH0 N T")],
    };
    const onEvent = { ...facts, wiktionaryReadings: (w: string) => WIKT[w] ?? [], readingsOf: (w: string) => GAME[w] ?? [] };

    it("sends it with a reason of its own, beside another key when Wiktionary misses too", () => {
      expect(huntAnswers(["lament", "vestment"], "EH N T", onEvent)).toEqual([
        { word: "vestment", reasons: ["another-key", "appended-only"], wiktionaryKeys: ["EH S T M AH N T"] },
      ]);
    });

    it("sends it though its Wiktionary readings agree, since they went through the same Normalisation", () => {
      expect(huntAnswers(["comment"], "EH N T", onEvent)).toEqual([
        { word: "comment", reasons: ["appended-only"], wiktionaryKeys: ["EH N T"] },
      ]);
    });

    it("does not send for this reason an Answer a source reading also puts on the key", () => {
      expect(huntAnswers(["segment"], "EH N T", onEvent)).toEqual([]);
    });

    it("counts the key's Schwa Twin as the key, as the other reason does", () => {
      const onFile = { ...facts, readingsOf: (w: string) => (w === "trial" ? [appended("T R AY1 AH0 L")] : []) };
      expect(huntAnswers(["trial"], "AY L", onFile).map((h) => h.reasons)).toEqual([["appended-only"]]);
    });
  });

  it("names each Answer once and in alphabetical order", () => {
    expect(huntAnswers(["grace", "chocolate", "grace"], "EY T", facts).map((h) => h.word)).toEqual(["chocolate", "grace"]);
  });
});

const rhyme = (verdict: RhymeRuling["verdict"], confidence: RhymeRuling["confidence"]): RhymeRuling => ({ verdict, reading: null, confidence, why: "" });
const wordhood = (word: string, verdict: WordhoodRuling["verdict"], confidence: WordhoodRuling["confidence"]): WordhoodRuling => ({ word, verdict, confidence, why: "" });
const hunted = (word: string): HuntedAnswer => ({ word, reasons: ["another-key"], wiktionaryKeys: [] });
const ruled = (word: string, rhymeRuling: RhymeRuling, wordhoodRuling?: WordhoodRuling): HuntRuling => ({
  seedWord: "ate", rhymeKey: "EY T", answer: hunted(word), rhyme: rhymeRuling, ...(wordhoodRuling ? { wordhood: wordhoodRuling } : {}),
});

describe("the ruling list", () => {
  it("lists a high-confidence non-rhyme, a name and nothing else, and a non-word", () => {
    const list = rulingList([
      ruled("chocolate", rhyme("no-rhyme", "high"), wordhood("chocolate", "word", "high")),
      ruled("kate", rhyme("rhyme", "high"), wordhood("kate", "name", "high")),
      ruled("lbs", rhyme("rhyme", "medium"), wordhood("lbs", "not-a-word", "high")),
    ]);
    expect(list.map((l) => [l.answer.word, l.doubts])).toEqual([
      ["chocolate", ["no-rhyme"]],
      ["kate", ["name"]],
      ["lbs", ["not-a-word"]],
    ]);
  });

  it("leaves alone everything below high confidence, and every ruling that the Answer is a word that rhymes", () => {
    const list = rulingList([
      ruled("chocolate", rhyme("no-rhyme", "medium"), wordhood("chocolate", "word", "high")),
      ruled("kate", rhyme("rhyme", "high"), wordhood("kate", "name", "medium")),
      ruled("freight", rhyme("rhyme", "high"), wordhood("freight", "word", "high")),
      ruled("late", rhyme("no-ruling", "low")),
    ]);
    expect(list).toEqual([]);
  });

  it("lists an Answer once with every doubt it has", () => {
    const list = rulingList([ruled("heinz", rhyme("no-rhyme", "high"), wordhood("heinz", "name", "high"))]);
    expect(list.map((l) => l.doubts)).toEqual([["no-rhyme", "name"]]);
  });
});

describe("a day's group of Answers only Normalisation puts on the key (#297)", () => {
  /** A ruling on `event` /EH N T/ unless another day is given. */
  const on = (word: string, reasons: HuntReason[], rhymeRuling: RhymeRuling, day = { seedWord: "event", rhymeKey: "EH N T" }): HuntRuling => ({
    ...day, answer: { word, reasons, wiktionaryKeys: [] }, rhyme: rhymeRuling,
  });
  const words = (group: AppendedGroup) => group.members.map((m) => [m.answer.word, m.doubts]);

  it("lists every appended-only Answer on a day the Judge holds one, in one group, the held ones marked", () => {
    // 2027-01-12: the Judge held `vestment` and passed `comment` and `document`, which have the same shape.
    const { answers, groups } = huntListing([
      on("comment", ["appended-only"], rhyme("rhyme", "high")),
      on("document", ["appended-only"], rhyme("rhyme", "medium")),
      on("vestment", ["appended-only"], rhyme("no-rhyme", "high")),
    ]);
    expect(answers).toEqual([]);
    expect(groups.map((g) => [g.seedWord, g.rhymeKey])).toEqual([["event", "EH N T"]]);
    expect(words(groups[0]!)).toEqual([["comment", []], ["document", []], ["vestment", ["no-rhyme"]]]);
  });

  it("lists nothing for this reason on a day the Judge holds none of them", () => {
    const { answers, groups } = huntListing([
      on("comment", ["appended-only"], rhyme("rhyme", "high")),
      on("vestment", ["appended-only"], rhyme("no-rhyme", "medium")),
    ]);
    expect(answers).toEqual([]);
    expect(groups).toEqual([]);
  });

  it("groups each day apart, and only the days with a hold", () => {
    const flex = { seedWord: "flex", rhymeKey: "EH K S" };
    const { groups } = huntListing([
      on("comment", ["appended-only"], rhyme("no-rhyme", "high")),
      on("prospects", ["appended-only"], rhyme("rhyme", "high"), flex),
      on("vestment", ["appended-only"], rhyme("rhyme", "high")),
    ]);
    expect(groups.map((g) => [g.seedWord, g.members.map((m) => m.answer.word)])).toEqual([["event", ["comment", "vestment"]]]);
  });

  it("holds a day on a name or a non-word as on no Rhyme", () => {
    const { groups } = huntListing([
      { ...on("lament", ["names-hit", "appended-only"], rhyme("rhyme", "high")), wordhood: wordhood("lament", "name", "high") },
      on("comment", ["appended-only"], rhyme("rhyme", "high")),
    ]);
    expect(words(groups[0]!)).toEqual([["lament", ["name"]], ["comment", []]]);
  });

  it("lists a word already listed for another reason once, in the group", () => {
    const { answers, groups } = huntListing([
      on("vestment", ["another-key", "appended-only"], rhyme("no-rhyme", "high")),
      on("comment", ["appended-only"], rhyme("rhyme", "high")),
      // Doubted on the same day for another reason alone, so it is no member of the group.
      on("cement", ["another-key"], rhyme("no-rhyme", "high")),
    ]);
    expect(answers.map((a) => a.answer.word)).toEqual(["cement"]);
    expect(words(groups[0]!)).toEqual([["vestment", ["no-rhyme"]], ["comment", []]]);
  });

  it("lists what the ruling list always has when no day has a group", () => {
    const rulings = [on("cement", ["another-key"], rhyme("no-rhyme", "high")), on("lament", ["names-hit"], rhyme("rhyme", "high"))];
    expect(huntListing(rulings)).toEqual({ answers: rulingList(rulings), groups: [] });
  });
});

describe("the No False Accepts gate", () => {
  const listed = ["chocolate", "kate", "freight"];

  it("passes when every listed Answer is ruled and none the maintainer corrected or demoted is still scored", () => {
    const result = noFalseAcceptsResult(
      listed,
      new Map([["chocolate", { kind: "correction", reading: r("CH AA1 K L AH0 T") }], ["kate", { kind: "demotion", reason: "proper-noun" }], ["freight", { kind: "leave" }]]),
      (w) => w === "freight",
    );
    expect(result).toEqual({ result: "pass", unruled: [], stillScored: [] });
  });

  it("fails on a listed Answer left unruled, since it stays scored with nobody's word that it should", () => {
    const result = noFalseAcceptsResult(listed, new Map([["chocolate", { kind: "leave" }], ["kate", { kind: "unruled" }]]), () => true);
    expect(result).toEqual({ result: "fail", unruled: ["freight", "kate"], stillScored: [] });
  });

  it("fails on a correction or Demotion that left the Answer scored", () => {
    const result = noFalseAcceptsResult(["chocolate"], new Map([["chocolate", { kind: "correction", reading: r("CH AA1 K L EY2 T") }]]), () => true);
    expect(result).toEqual({ result: "fail", unruled: [], stillScored: ["chocolate"] });
  });

  it("counts keeping readings as a ruling, whether or not what was kept still rhymes on the day", () => {
    // `environmental` keeps its readings with the t: it leaves `kennel` and stays on `incidental`.
    const result = noFalseAcceptsResult(["environmental"], new Map([["environmental", { kind: "keep", readings: [r("IH0 N V AY2 R AH0 N M EH1 N T AH0 L")] }]]), () => true);
    expect(result).toEqual({ result: "pass", unruled: [], stillScored: [] });
  });

  it("passes a day with nothing on the list", () => {
    expect(noFalseAcceptsResult([], new Map(), () => true).result).toBe("pass");
  });
});
