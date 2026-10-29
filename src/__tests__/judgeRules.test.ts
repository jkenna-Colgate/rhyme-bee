/**
 * The rules of #232 by machine (#250): the labelling tool that decides the pairs
 * a person need not rule on. Worked examples from #232 and the prototype's own
 * labels, on a hand-written lexicon.
 */

import { describe, expect, it } from "vitest";
import { decide, type RulesLexicon } from "../judgeRules.ts";

const READINGS: Record<string, string[]> = {
  magic: ["M AE1 JH IH0 K"],
  rebut: ["R IH0 B AH1 T"],
  klutz: ["K L AH1 T S"],
  late: ["L EY1 T"],
  shooter: ["SH UW1 D ER0"],
  pea: ["P IY1"],
  heretic: ["HH EH1 R AH0 T IH0 K"],
};
const WORDS = new Set([...Object.keys(READINGS), "rebuts", "grates", "peashooter", "zorb"]);
const KNOWN = new Set(["pea", "shooter", "late"]);

const lex: RulesLexicon = {
  readingsOf: (w) => (READINGS[w] ?? []).map((r) => r.split(" ")),
  unmergedReadingsOf: (w) => (READINGS[w] ?? []).map((r) => r.split(" ")),
  isWord: (w) => WORDS.has(w),
  known: (w) => KNOWN.has(w),
};
const pair = (word: string, rhymeKey: string, wiktionary: string[] = []) => ({ word, rhymeKey, wiktionary });

describe("the rules of #232, by machine", () => {
  it("label a Rhyme the engine's own reading makes", () => {
    expect(decide(pair("late", "EY T"), lex).verdict).toBe("rhyme");
  });

  it("label a match on an unstressed last syllable no Points", () => {
    expect(decide(pair("magic", "IH K"), lex)).toEqual({ verdict: "no-rhyme", why: "the last syllable matches and is unstressed: no Points" });
  });

  it("keep the lunatic shape out of the question", () => {
    expect(decide(pair("heretic", "IH K"), lex).verdict).toBe("out");
  });

  it("derive a regular form's reading from its stem's", () => {
    expect(decide(pair("rebuts", "AH T S"), lex)).toEqual({ verdict: "rhyme", why: "no reading on file; the regular form of rebut reaches the key" });
  });

  it("put a derived Rhyme to a person when Wiktionary says it ends otherwise", () => {
    expect(decide(pair("rebuts", "AH T S", ["ɹ ɪ b ʌ d z"]), lex).verdict).toBe("ask");
  });

  it("read a compound's last part with its stress kept as a secondary", () => {
    expect(decide(pair("peashooter", "UW D ER"), lex).verdict).toBe("rhyme");
  });

  it("hear Wiktionary's t as the build's tap inside the key", () => {
    // `peashooter` is transcribed with a t, and the key holds the tap.
    expect(decide(pair("peashooter", "UW D ER", ["p i ʃ u t ɚ"]), lex).verdict).toBe("rhyme");
  });

  it("let Wiktionary refute a word with no reading, and never prove one of several syllables", () => {
    expect(decide(pair("grates", "EY T S", ["ɡ ɹ æ t s"]), lex).verdict).toBe("no-rhyme");
    expect(decide(pair("grates", "EY T S", ["ɡ ɹ e ɪ t s"]), lex).verdict).toBe("rhyme");
    expect(decide(pair("zorb", "AO R B"), lex).verdict).toBe("ask");
  });

  it("leave a word off the word list out of the question", () => {
    expect(decide(pair("kate", "EY T"), lex).verdict).toBe("out");
  });
});
