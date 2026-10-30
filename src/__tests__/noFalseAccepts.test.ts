/**
 * The No False Accepts half of a Batch (#268), as pure functions: which scored
 * Answers the hunt puts to the Judge, which of the Judge's rulings go on the
 * maintainer's ruling list, how a typed ruling is read, and the gate's verdict
 * once the maintainer has ruled (GLOSSARY.md, Playability Bar; #225, #242).
 */

import { describe, expect, it } from "vitest";
import type { RhymeRuling, WordhoodRuling } from "../judge.ts";
import {
  huntAnswers,
  noFalseAcceptsResult,
  parseDecision,
  rulingList,
  rulingPrompt,
  type HuntedAnswer,
  type HuntRuling,
} from "../noFalseAccepts.ts";
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
const facts = {
  wiktionaryReadings: (w: string) => WIKTIONARY[w] ?? [],
  isName: (w: string) => NAMES.has(w),
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

describe("reading the maintainer's ruling", () => {
  const offered = [r("CH AA1 K L AH0 T")];

  it("reads a correction as one of the readings offered, or as a reading typed in ARPAbet", () => {
    expect(parseDecision("c 1", offered)).toEqual({ kind: "correction", reading: r("CH AA1 K L AH0 T") });
    expect(parseDecision("c ch aa1 k ah0 l ah0 t", offered)).toEqual({ kind: "correction", reading: r("CH AA1 K AH0 L AH0 T") });
  });

  it("reads a Demotion with the rejection the player will get, a name by default", () => {
    expect(parseDecision("d", offered)).toEqual({ kind: "demotion", reason: "proper-noun" });
    expect(parseDecision("d word", offered)).toEqual({ kind: "demotion", reason: "not-a-known-word" });
  });

  it("reads leaving it alone, and skipping it unruled", () => {
    expect(parseDecision("l", offered)).toEqual({ kind: "leave" });
    expect(parseDecision("s", offered)).toEqual({ kind: "unruled" });
  });

  it("reads nothing from a reading that is not ARPAbet or a number outside the list", () => {
    expect(parseDecision("c 2", offered)).toBeNull();
    expect(parseDecision("c tʃɑk", offered)).toBeNull();
    expect(parseDecision("x", offered)).toBeNull();
  });
});

describe("asking the maintainer for a ruling", () => {
  it("labels the readings it numbers, says it is waiting, and gives one option a line with its effect", () => {
    expect(rulingPrompt([r("CH AA1 K L AH0 T"), r("CH AO1 K L AH0 T")])).toEqual([
      "Readings you can pick (Wiktionary's, in ARPAbet):",
      "  1. CH AA1 K L AH0 T",
      "  2. CH AO1 K L AH0 T",
      "Waiting for your ruling on this word. Type one of these and press Enter:",
      "  c <n>        correct the reading to number <n> above, e.g. c 1 (it replaces the game's reading)",
      "  c <ARPAbet>  correct the reading to one you type, e.g. c K AE1 T (it replaces the game's reading)",
      "  d            demote it as a name (the player is told it is a name)",
      "  d word       demote it as not a word (the player is told it is not a word)",
      "  l            leave it scored, as the game has it",
      "  s            skip it: it stays scored unruled, and the day fails its No False Accepts gate",
    ]);
  });

  it("offers no number to pick when there are no readings to pick from", () => {
    const prompt = rulingPrompt([]);
    expect(prompt[0]).toBe("Readings you can pick: none (Wiktionary has none), so a correction must be typed.");
    expect(prompt.some((line) => line.includes("c <n>"))).toBe(false);
    expect(prompt).toContain("  c <ARPAbet>  correct the reading to one you type, e.g. c K AE1 T (it replaces the game's reading)");
  });

  it("accepts every option it offers", () => {
    const offered = [r("CH AA1 K L AH0 T")];
    expect(["c 1", "c K AE1 T", "d", "d word", "l", "s"].map((input) => parseDecision(input, offered))).not.toContain(null);
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

  it("passes a day with nothing on the list", () => {
    expect(noFalseAcceptsResult([], new Map(), () => true).result).toBe("pass");
  });
});
