/**
 * The Judge as an instrument (#250): the prompts it is sent, how its replies are
 * read, the reading check, which Candidates it is asked about, and where a
 * ruling *would* land. Nothing here calls a model or writes a file; the replies
 * are written out by hand, the way a model sends them.
 */

import { describe, expect, it } from "vitest";
import {
  classifyRuling,
  judgeQuestion,
  parseRhymeReply,
  parseWordhoodReply,
  readingReachesKey,
  rhymePrompt,
  wordhoodPrompt,
  type RhymeRuling,
} from "../judge.ts";

const ruling = (over: Partial<RhymeRuling> = {}): RhymeRuling => ({
  verdict: "rhyme",
  reading: "G R EY1 T S",
  confidence: "high",
  why: "the plural of grate",
  ...over,
});

describe("the rhyme prompt", () => {
  it("states the rules, lists each Candidate against its Seed Word, and asks for JSON", () => {
    const prompt = rhymePrompt([
      { word: "grates", seedWord: "plates" },
      { word: "chocolate", seedWord: "ate" },
    ]);

    expect(prompt.startsWith("You are ruling on Candidates for Rhyming Bee, a daily word game.")).toBe(true);
    expect(prompt).toContain('\nCandidates:\n- "grates" for the Seed Word "plates"\n- "chocolate" for the Seed Word "ate"\n');
    expect(prompt).toContain('"verdict": "rhyme" | "no-rhyme"');
    expect(prompt).not.toContain("not-a-word");
  });

  it("carries the r and l readings and the regional-reading sentence the margin was measured with", () => {
    const prompt = rhymePrompt([{ word: "dialed", seedWord: "wild" }]);

    expect(prompt).toContain("except for the r and l readings below.");
    expect(prompt).toContain('"trial" for "file", "jewel" for "rule", "towels" for "howls"');
    expect(prompt).toContain('A reading that belongs to one region does not count ("wash" said with an r, "greasy" said with a z)');
  });
});

describe("reading a rhyme reply", () => {
  it("takes one ruling per Candidate, in order", () => {
    const raw = `[{"word": "grates", "verdict": "rhyme", "reading": "G R EY1 T S", "confidence": "high", "why": "plural of grate"},
      {"word": "chocolate", "verdict": "no-rhyme", "reading": null, "confidence": "high", "why": "unstressed schwa"}]`;

    expect(parseRhymeReply(raw, 2)).toEqual([
      { verdict: "rhyme", reading: "G R EY1 T S", confidence: "high", why: "plural of grate" },
      { verdict: "no-rhyme", reading: null, confidence: "high", why: "unstressed schwa" },
    ]);
  });

  it("reads the last array when the Judge writes one, takes it back and writes it again", () => {
    const raw = `[{"word": "grates", "verdict": "no-rhyme", "reading": null, "confidence": "low", "why": "unsure"}]
Wait, that is wrong: grates is the plural of grate.
[{"word": "grates", "verdict": "rhyme", "reading": "G R EY1 T S", "confidence": "high", "why": "plural of grate"}]`;

    expect(parseRhymeReply(raw, 1)[0]!.verdict).toBe("rhyme");
  });

  it("gives every Candidate it cannot read a ruling of no-ruling", () => {
    const short = parseRhymeReply(`[{"word": "grates", "verdict": "rhyme", "reading": "G R EY1 T S", "confidence": "high", "why": "x"}]`, 2);
    expect(short[1]).toEqual({ verdict: "no-ruling", reading: null, confidence: "low", why: "unparseable reply" });

    expect(parseRhymeReply("I cannot help with that.", 1)[0]!.verdict).toBe("no-ruling");
  });

  it("reads a verdict it does not know as no-ruling", () => {
    const raw = `[{"word": "kate", "verdict": "not-a-word", "reading": null, "confidence": "high", "why": "a name"}]`;
    expect(parseRhymeReply(raw, 1)[0]!.verdict).toBe("no-ruling");
  });
});

describe("the wordhood question", () => {
  it("is asked apart from the rhyme, one word per line", () => {
    const prompt = wordhoodPrompt(["heinz", "sue"]);

    expect(prompt.startsWith("You are checking words for Rhyming Bee")).toBe(true);
    // The question comes first and the words last, as the prototype asked it.
    expect(prompt.endsWith("\nWords:\n- heinz\n- sue")).toBe(true);
    expect(prompt).toContain('"verdict": "word" | "name" | "not-a-word"');
  });

  it("reads each ruling against the word it was asked about, and no other", () => {
    const raw = `[{"word": "heinz", "verdict": "name", "confidence": "high", "why": "a brand"},
      {"word": "blue", "verdict": "word", "confidence": "high", "why": "a colour"}]`;

    expect(parseWordhoodReply(raw, ["heinz", "sue"])).toEqual([
      { word: "heinz", verdict: "name", confidence: "high", why: "a brand" },
      { word: "sue", verdict: "no-ruling", confidence: "low", why: "unparseable reply" },
    ]);
  });
});

describe("the reading check", () => {
  it("passes a reading whose Rhyme Key is the Seed Word's", () => {
    expect(readingReachesKey("G R EY1 T S", "EY T S")).toBe(true);
  });

  it("fails a reading that misses the key, and a missing reading", () => {
    expect(readingReachesKey("G R AE1 T S", "EY T S")).toBe(false);
    expect(readingReachesKey(null, "EY T S")).toBe(false);
    expect(readingReachesKey("", "EY T S")).toBe(false);
  });

  it("reads the Judge's reading the way the build reads the dictionary's", () => {
    // The Judge often writes the caught vowel, and the key holds the merged one.
    expect(readingReachesKey("AO1 L", "AA L")).toBe(true);
    // A t between a vowel and a weak vowel is the tap.
    expect(readingReachesKey("K R UW1 T ER0", "UW D ER")).toBe(true);
    // Case and spacing are the Judge's, not the dictionary's.
    expect(readingReachesKey("  g r ey1  t s ", "EY T S")).toBe(true);
  });

  it("fails a reading with a stray symbol rather than throw", () => {
    expect(readingReachesKey("G R EY1 T S.", "EY T S")).toBe(false);
  });
});

describe("which Candidates the Judge is asked about", () => {
  const split = (r: string) => r.split(" ");
  const facts = (readings: string[] = [], unmerged: string[] = readings, isWord = true) => ({
    isWord,
    readings: readings.map(split),
    unmergedReadings: unmerged.map(split),
  });

  it("asks about a word the game holds no reading for, as a Missing Reading", () => {
    expect(judgeQuestion(facts(), "EY T S")).toEqual({ ask: "missing-reading" });
  });

  it("asks about a word whose reading misses the key, as an Overrule", () => {
    expect(judgeQuestion(facts(["M AE1 JH IH0 K"]), "IH K")).toEqual({ ask: "overrule" });
  });

  it("does not ask about a word that already rhymes on the key: what is left is a Tier, not a sound", () => {
    expect(judgeQuestion(facts(["AA1 B JH ER0 G EY2 T"]), "EY T")).toEqual({ setAside: "already-rhymes" });
  });

  it("does not ask about a word off the word list: that is a wordhood question with no reading to rule on", () => {
    expect(judgeQuestion(facts([], [], false), "EY T")).toEqual({ setAside: "not-on-word-list" });
  });

  it("keeps the lunatic shape from the Judge, read off the weak vowel the dictionary wrote", () => {
    // `heretic` for `trick`: an unstressed syllable between the stress and a
    // last syllable that matches the key. #233 has since ruled, and #266 drops this.
    expect(judgeQuestion(facts(["HH EH1 R AH0 D AH0 K"], ["HH EH1 R AH0 T IH0 K"]), "IH K")).toEqual({ setAside: "lunatic-shape" });
  });
});

describe("where a ruling would land", () => {
  const word = { word: "grates", verdict: "word", confidence: "high", why: "" } as const;

  it("writes a reading for a Missing Reading ruled a Rhyme at high confidence, once it is found to be a word", () => {
    expect(classifyRuling("missing-reading", ruling(), "EY T S", word)).toEqual({
      knew: "missing-reading",
      verdict: "rhyme",
      confidence: "high",
      reachesKey: true,
      lands: "reading",
      needsWordhood: false,
    });
  });

  it("says when the wordhood question is still to be asked", () => {
    const c = classifyRuling("missing-reading", ruling(), "EY T S");
    expect([c.lands, c.needsWordhood]).toEqual(["reading", true]);
  });

  it("lists an Unconfirmed Rhyme for a Missing Reading at medium confidence", () => {
    expect(classifyRuling("missing-reading", ruling({ confidence: "medium" }), "EY T S", word).lands).toBe("unconfirmed-rhyme");
  });

  it("lists an Unconfirmed Rhyme for an Overrule at high confidence, and never a reading", () => {
    expect(classifyRuling("overrule", ruling(), "EY T S", word).lands).toBe("unconfirmed-rhyme");
  });

  it("leaves everything else to the Editor's Pass, and asks no wordhood question for it", () => {
    const cases: [Parameters<typeof classifyRuling>[0], RhymeRuling][] = [
      ["missing-reading", ruling({ confidence: "low" })],
      ["missing-reading", ruling({ reading: "G R AE1 T S" })],
      ["overrule", ruling({ confidence: "medium" })],
      ["overrule", ruling({ reading: null })],
      ["missing-reading", ruling({ verdict: "no-rhyme", reading: null })],
      ["overrule", ruling({ verdict: "no-ruling", reading: null })],
    ];
    for (const [knew, r] of cases) {
      const c = classifyRuling(knew, r, "EY T S");
      expect([c.lands, c.needsWordhood]).toEqual(["editors-pass", false]);
    }
  });

  it("holds back what the wordhood question finds is a name or not a word, at any confidence, as a suggested Demotion", () => {
    const name = { ...word, verdict: "name", confidence: "low" } as const;
    const notAWord = { ...word, verdict: "not-a-word" } as const;
    expect(classifyRuling("missing-reading", ruling(), "EY T S", name).lands).toBe("demotion");
    expect(classifyRuling("overrule", ruling(), "EY T S", notAWord).lands).toBe("demotion");
  });

  it("writes nothing when the wordhood question gets no answer it can read", () => {
    const none = { ...word, verdict: "no-ruling", confidence: "low" } as const;
    expect(classifyRuling("missing-reading", ruling(), "EY T S", none).lands).toBe("editors-pass");
  });
});
