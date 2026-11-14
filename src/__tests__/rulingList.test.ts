/**
 * The Batch's ruling list (#268, #292 to #295), as pure functions: the readings
 * shown for a hunted Answer, and for each kind of item what the maintainer is
 * shown and how what they type is read.
 */

import { describe, expect, it } from "vitest";
import type { UndecidedRhyme, UntieredWord, WrittenInAnswer } from "../batch.ts";
import type { TierRuling } from "../judge.ts";
import type { Pronunciation } from "../phonology.ts";
import {
  parseDecision,
  parseTier,
  parseUndecided,
  parseWrittenInAnswer,
  rulingPrompt,
  shownReadings,
  tierAgreement,
  tierPrompt,
  undecidedPrompt,
  writtenInAnswerPrompt,
} from "../rulingList.ts";

const r = (s: string): Pronunciation => s.split(" ");

describe("the readings shown for a ruling", () => {
  it("lists the game's readings first, marking those Normalisation appended, then Wiktionary's the game lacks", () => {
    const game = [
      { pronunciation: r("IH0 N V AY2 R AH0 N M EH1 N T AH0 L"), generated: false },
      { pronunciation: r("IH0 N V AY2 R AH0 N M EH1 N AH0 L"), generated: false },
      { pronunciation: r("IH0 N V AY2 R AH0 N M EH1 N T L"), generated: true },
    ];
    const wiktionary = [r("IH0 N V AY2 R AH0 N M EH1 N T AH0 L"), r("EH0 N V AY2 R AH0 N M EH1 N T AH0 L"), r("EH0 N V AY2 R AH0 N M EH1 N T AH0 L")];
    expect(shownReadings(game, wiktionary)).toEqual([
      { reading: r("IH0 N V AY2 R AH0 N M EH1 N T AH0 L"), from: "game" },
      { reading: r("IH0 N V AY2 R AH0 N M EH1 N AH0 L"), from: "game" },
      { reading: r("IH0 N V AY2 R AH0 N M EH1 N T L"), from: "normalisation", madeFrom: [r("IH0 N V AY2 R AH0 N M EH1 N T AH0 L")] },
      { reading: r("EH0 N V AY2 R AH0 N M EH1 N T AH0 L"), from: "wiktionary" },
    ]);
  });
});

describe("reading the maintainer's ruling", () => {
  const shown = shownReadings(
    [{ pronunciation: r("CH AA1 K L AH0 T"), generated: false }, { pronunciation: r("CH AA1 K L EY2 T"), generated: false }],
    [r("CH AA1 K AH0 L AH0 T")],
  );

  it("reads a correction as one of the readings shown, or as a reading typed in ARPAbet", () => {
    expect(parseDecision("c 1", shown)).toEqual({ kind: "correction", reading: r("CH AA1 K L AH0 T") });
    expect(parseDecision("c 3", shown)).toEqual({ kind: "correction", reading: r("CH AA1 K AH0 L AH0 T") });
    expect(parseDecision("c ch aa1 k ah0 l ah0 t", shown)).toEqual({ kind: "correction", reading: r("CH AA1 K AH0 L AH0 T") });
  });

  it("reads keeping exactly the readings numbered, in the order shown, once each", () => {
    expect(parseDecision("k 1 3", shown)).toEqual({ kind: "keep", readings: [r("CH AA1 K L AH0 T"), r("CH AA1 K AH0 L AH0 T")] });
    expect(parseDecision("k 3 1 3", shown)).toEqual({ kind: "keep", readings: [r("CH AA1 K L AH0 T"), r("CH AA1 K AH0 L AH0 T")] });
    expect(parseDecision("K 2", shown)).toEqual({ kind: "keep", readings: [r("CH AA1 K L EY2 T")] });
  });

  it("reads keeping some readings and adding one typed", () => {
    expect(parseDecision("k 1 ch ao1 k l ah0 t", shown)).toEqual({ kind: "keep", readings: [r("CH AA1 K L AH0 T"), r("CH AO1 K L AH0 T")] });
    // A typed reading already kept is kept once.
    expect(parseDecision("k 1 CH AA1 K L AH0 T", shown)).toEqual({ kind: "keep", readings: [r("CH AA1 K L AH0 T")] });
  });

  it("reads a Demotion with the rejection the player will get, a name by default", () => {
    expect(parseDecision("d", shown)).toEqual({ kind: "demotion", reason: "proper-noun" });
    expect(parseDecision("d word", shown)).toEqual({ kind: "demotion", reason: "not-a-known-word" });
  });

  it("reads leaving it alone, and skipping it unruled", () => {
    expect(parseDecision("l", shown)).toEqual({ kind: "leave" });
    expect(parseDecision("s", shown)).toEqual({ kind: "unruled" });
  });

  it("reads nothing from a reading that is not ARPAbet or a number outside the list", () => {
    expect(parseDecision("c 4", shown)).toBeNull();
    expect(parseDecision("c tʃɑk", shown)).toBeNull();
    expect(parseDecision("x", shown)).toBeNull();
    expect(parseDecision("", shown)).toBeNull();
  });

  describe("with a reading Normalisation appended (#323)", () => {
    // camel's syllabic variant, numbered 2 after the reading it was made from; 3 is Wiktionary's.
    const appended = shownReadings(
      [{ pronunciation: r("K AE1 M AH0 L"), generated: false }, { pronunciation: r("K AE1 M L"), generated: true }],
      [r("K AA1 M AH0 L")],
    );

    it("numbers it like the others, so it can be kept or corrected to", () => {
      expect(parseDecision("c 2", appended)).toEqual({ kind: "correction", reading: r("K AE1 M L") });
      expect(parseDecision("c 3", appended)).toEqual({ kind: "correction", reading: r("K AA1 M AH0 L") });
    });

    it("reads a keep of its source without it as a Normalisation Exception for it", () => {
      expect(parseDecision("k 1", appended)).toEqual({ kind: "keep", readings: [r("K AE1 M AH0 L")], excepted: [r("K AE1 M L")] });
      expect(parseDecision("k 1 3", appended)).toEqual({ kind: "keep", readings: [r("K AE1 M AH0 L"), r("K AA1 M AH0 L")], excepted: [r("K AE1 M L")] });
    });

    it("reads a keep of both as no exception, and writes the appended one nowhere: the build makes it", () => {
      expect(parseDecision("k 1 2", appended)).toEqual({ kind: "keep", readings: [r("K AE1 M AH0 L")] });
      expect(parseDecision("k 2 1 3", appended)).toEqual({ kind: "keep", readings: [r("K AE1 M AH0 L"), r("K AA1 M AH0 L")] });
    });

    it("reads nothing from a keep of it without a reading it was made from", () => {
      expect(parseDecision("k 2", appended)).toBeNull();
      expect(parseDecision("k 2 3", appended)).toBeNull();
      expect(parseDecision("k 2 K AE1 M AH0 L", appended)).toBeNull();
    });

    it("writes no exception for one whose source goes too, since nothing makes it again", () => {
      expect(parseDecision("k 3", appended)).toEqual({ kind: "keep", readings: [r("K AA1 M AH0 L")] });
    });

    it("excepts a reading appended to an appended reading along with the one it was made from", () => {
      // Stress promotion appends vampire's second reading, and glide-r appends the third to that.
      const chain = shownReadings(
        [
          { pronunciation: r("V AE1 M P AY0 R"), generated: false },
          { pronunciation: r("V AE1 M P AY2 R"), generated: true },
          { pronunciation: r("V AE1 M P AY2 ER0"), generated: true },
        ],
        [],
      );
      expect(parseDecision("k 1", chain)).toEqual({ kind: "keep", readings: [r("V AE1 M P AY0 R")], excepted: [r("V AE1 M P AY2 R"), r("V AE1 M P AY2 ER0")] });
      expect(parseDecision("k 1 2", chain)).toEqual({ kind: "keep", readings: [r("V AE1 M P AY0 R")], excepted: [r("V AE1 M P AY2 ER0")] });
      // The third was made from the second, which is not kept.
      expect(parseDecision("k 1 3", chain)).toBeNull();
    });
  });

  it("reads nothing from a keep that names no reading shown, or adds one that is not ARPAbet", () => {
    expect(parseDecision("k", shown)).toBeNull();
    expect(parseDecision("k 0", shown)).toBeNull();
    expect(parseDecision("k 1 4", shown)).toBeNull();
    expect(parseDecision("k 1 tʃɑk", shown)).toBeNull();
    expect(parseDecision("k 1 CH AA1 K 2", shown)).toBeNull();
    // Typing a reading alone is a correction, `c`.
    expect(parseDecision("k CH AA1 K L AH0 T", shown)).toBeNull();
  });
});

describe("asking the maintainer for a ruling", () => {
  const shown = shownReadings(
    [{ pronunciation: r("K AE1 M AH0 L"), generated: false }, { pronunciation: r("K AE1 M L"), generated: true }],
    [r("K AA1 M AH0 L")],
  );

  it("numbers the readings under who holds them, says it is waiting, and gives one command a line with its effect", () => {
    expect(rulingPrompt(shown)).toEqual([
      "The game's readings of this word (ARPAbet):",
      "  1. K AE1 M AH0 L",
      "  2. K AE1 M L  (appended by Normalisation to 1: keep 1 without it and a Normalisation Exception is written for it)",
      "Wiktionary's readings the game lacks, which you can add:",
      "  3. K AA1 M AH0 L",
      "Waiting for your ruling on this word. Type one of these and press Enter:",
      "  k <n> <n> ...        keep only the readings numbered, e.g. k 1 2 (every other reading goes)",
      "  k <n> ... <ARPAbet>  keep those and add one you type, e.g. k 1 K AE1 T",
      "  c <n>                correct the reading to number <n> alone, e.g. c 1 (it replaces every reading)",
      "  c <ARPAbet>          correct the reading to one you type, e.g. c K AE1 T (it replaces every reading)",
      "  d                    demote it as a name (the player is told it is a name)",
      "  d word               demote it as not a word (the player is told it is not a word)",
      "  l                    leave it scored, as the game has it",
      "  s                    skip it: it stays scored unruled, and the day fails its No False Accepts gate",
    ]);
  });

  it("says when Wiktionary has no reading the game lacks", () => {
    const prompt = rulingPrompt(shownReadings([{ pronunciation: r("CH AA1 K L AH0 T"), generated: false }], [r("CH AA1 K L AH0 T")]));
    expect(prompt.slice(0, 3)).toEqual([
      "The game's readings of this word (ARPAbet):",
      "  1. CH AA1 K L AH0 T",
      "Wiktionary's readings the game lacks: none.",
    ]);
  });

  it("offers no number to pick when there are no readings to pick from", () => {
    const prompt = rulingPrompt([]);
    expect(prompt[0]).toBe("Readings you can pick: none (the game and Wiktionary have none), so a correction must be typed.");
    expect(prompt.some((line) => line.includes("<n>"))).toBe(false);
    expect(prompt).toContain("  c <ARPAbet>          correct the reading to one you type, e.g. c K AE1 T (it replaces every reading)");
  });

  it("accepts every command it names", () => {
    for (const readings of [shown, []]) {
      const commands = rulingPrompt(readings).filter((line) => /^ {2}[a-z]/.test(line));
      expect(commands.length).toBeGreaterThan(0);
      for (const line of commands) {
        // The example the line gives, or else the command as written.
        const typed = /e\.g\. (.+?)(?: \(|$)/.exec(line)?.[1] ?? line.trim().split(/\s{2,}/)[0]!;
        expect(parseDecision(typed, readings), line).not.toBeNull();
      }
    }
  });
});

describe("asking the maintainer about a rhyme the Judge left undecided", () => {
  const house: UndecidedRhyme = {
    word: "house", seedWord: "arouse", rhymeKey: "AW Z", knew: "overrule", confidence: "medium",
    why: "the verb, /haʊz/", heard: "HH AW1 Z", reading: r("HH AW1 Z"),
  };
  // The Judge's reading misses the key, so there is none to confirm as it stands.
  const barbar: UndecidedRhyme = {
    word: "barbar", seedWord: "guitar", rhymeKey: "AA R", knew: "missing-reading", confidence: "low",
    why: "probably", heard: "B AA1 R B AH0 R", reading: null,
  };

  it("shows what the Judge heard and why nothing landed, says it is waiting, and gives one command a line with its effect", () => {
    expect(undecidedPrompt(house)).toEqual([
      "The Judge ruled it a Rhyme at medium confidence, and nothing landed: the game's readings miss /AW Z/ (an Overrule).",
      "  The Judge's reading: HH AW1 Z",
      "  The Judge's reasoning: the verb, /haʊz/",
      "Waiting for your ruling on this rhyme. Type one of these and press Enter:",
      "  y                    confirm it: HH AW1 Z is written beside the word's readings, so it rhymes on /AW Z/ from then on",
      "  y <ARPAbet>          confirm it with a reading you type instead, e.g. y HH AW1 Z (written beside the word's readings)",
      "  n                    decline it: a Decline is recorded for house on /AW Z/, so it is not raised again",
      "  s                    skip it: nothing is written, and the run report lists it",
    ]);
  });

  it("offers no confirming of the Judge's reading when it misses the key, only of one typed", () => {
    const prompt = undecidedPrompt(barbar);
    expect(prompt.slice(0, 2)).toEqual([
      "The Judge ruled it a Rhyme at low confidence, and nothing landed: the game has no reading of it (a Missing Reading).",
      "  The Judge's reading: B AA1 R B AH0 R, which misses /AA R/, so confirming needs a reading typed",
    ]);
    expect(prompt.some((line) => /^ {2}y {2,}/.test(line))).toBe(false);
    // The example is the Rhyme Key itself said as a word, so it reads as one the key would take.
    expect(prompt).toContain("  y <ARPAbet>          confirm it with a reading you type, e.g. y AA1 R (written beside the word's readings)");
  });

  it("reads confirming as the Judge's reading, or as one typed in ARPAbet", () => {
    expect(parseUndecided("y", house)).toEqual({ kind: "confirm", reading: r("HH AW1 Z") });
    expect(parseUndecided("Y hh aw1 z", house)).toEqual({ kind: "confirm", reading: r("HH AW1 Z") });
    expect(parseUndecided("y B AA1 R B AA2 R", barbar)).toEqual({ kind: "confirm", reading: r("B AA1 R B AA2 R") });
  });

  it("refuses a typed reading that misses the Rhyme Key, so it asks again and writes nothing", () => {
    expect(parseUndecided("y K AE1 T", house)).toBeNull();
    expect(parseUndecided("y B AA1 R B AH0 R", barbar)).toBeNull();
  });

  it("reads a typed reading as Normalisation will, so the caught vowel confirms on the merged key", () => {
    const doll: UndecidedRhyme = { ...barbar, word: "gall", seedWord: "doll", rhymeKey: "AA L", heard: null };
    expect(parseUndecided("y G AO1 L", doll)).toEqual({ kind: "confirm", reading: r("G AO1 L") });
  });

  it("neither offers nor confirms a Judge's reading that misses the Rhyme Key, however it came to be held", () => {
    const astray: UndecidedRhyme = { ...house, reading: r("HH AW1 S") };
    expect(parseUndecided("y", astray)).toBeNull();
    expect(undecidedPrompt(astray).some((line) => /^ {2}y {2,}/.test(line))).toBe(false);
  });

  it("reads declining, and skipping it unruled", () => {
    expect(parseUndecided("n", house)).toEqual({ kind: "decline" });
    expect(parseUndecided("s", house)).toEqual({ kind: "unruled" });
  });

  it("reads nothing it cannot act on, so the caller asks again and writes nothing", () => {
    // No Judge's reading to confirm.
    expect(parseUndecided("y", barbar)).toBeNull();
    expect(parseUndecided("y haʊz", house)).toBeNull();
    expect(parseUndecided("n word", house)).toBeNull();
    // A hunted Answer's commands are not this item's: `d` would read as a Demotion there.
    expect(parseUndecided("d", house)).toBeNull();
    expect(parseUndecided("c 1", house)).toBeNull();
    expect(parseUndecided("", house)).toBeNull();
  });

  it("accepts every command it names", () => {
    for (const rhyme of [house, barbar]) {
      const commands = undecidedPrompt(rhyme).filter((line) => /^ {2}[a-z]/.test(line));
      expect(commands.length).toBeGreaterThan(0);
      for (const line of commands) {
        const typed = /e\.g\. (.+?)(?: \(|$)/.exec(line)?.[1] ?? line.trim().split(/\s{2,}/)[0]!;
        expect(parseUndecided(typed, rhyme), line).not.toBeNull();
      }
    }
  });
});

describe("asking the maintainer to Tier a written-in word with no knownness", () => {
  const throwdown: UntieredWord = { word: "throwdown", seedWord: "down", rhymeKey: "AW N" };

  it("says why it is asked, names the Seed Word, says it is waiting, and gives one command a line with its effect", () => {
    expect(tierPrompt(throwdown)).toEqual([
      "Nothing measures how well known it is, so it is a Bonus Word until you Tier it.",
      "Would an ordinary player think of throwdown when hunting rhymes for down?",
      "Waiting for your Tier ruling on this word. Type one of these and press Enter:",
      "  a                    Answer: a Tier verdict is written to data/tier-overrides.csv, so it scores from the next build",
      "  b                    Bonus Word: a Tier verdict is written to data/tier-overrides.csv, so it stays accepted and unscored",
      "  s                    skip it: nothing is written, and the run report lists it",
    ]);
  });

  it("reads an Answer, a Bonus Word, and skipping it unruled", () => {
    expect(parseTier("a")).toEqual({ kind: "tier", tier: "answer" });
    expect(parseTier(" B ")).toEqual({ kind: "tier", tier: "bonus" });
    expect(parseTier("s")).toEqual({ kind: "unruled" });
  });

  it("reads nothing it cannot act on, so the caller asks again and writes nothing", () => {
    expect(parseTier("")).toBeNull();
    expect(parseTier("a b")).toBeNull();
    expect(parseTier("answer")).toBeNull();
    // Other items' commands are not this one's.
    expect(parseTier("y")).toBeNull();
    expect(parseTier("d")).toBeNull();
    expect(parseTier("l")).toBeNull();
  });

  const judgeSays = (verdict: TierRuling["verdict"], confidence: TierRuling["confidence"] = "medium"): TierRuling =>
    ({ word: "throwdown", verdict, confidence, why: "a common compound of down" });

  it("fills in the Judge's answer, with its confidence, as what Enter accepts", () => {
    expect(tierPrompt(throwdown, judgeSays("answer"))).toEqual([
      "Nothing measures how well known it is, so it is a Bonus Word until you Tier it.",
      "Would an ordinary player think of throwdown when hunting rhymes for down?",
      "The Judge's answer: Answer, at medium confidence: a common compound of down",
      "Waiting for your Tier ruling on this word. Type one of these and press Enter:",
      "  Enter                accept the Judge's answer, Answer: a Tier verdict is written to data/tier-overrides.csv, so it scores from the next build",
      "  a                    Answer: a Tier verdict is written to data/tier-overrides.csv, so it scores from the next build",
      "  b                    Bonus Word: a Tier verdict is written to data/tier-overrides.csv, so it stays accepted and unscored",
      "  s                    skip it: nothing is written, and the run report lists it",
    ]);
  });

  it("says when the Judge gave no answer, and offers nothing for Enter to accept", () => {
    const prompt = tierPrompt(throwdown, judgeSays("no-ruling", "low"));
    expect(prompt[2]).toBe("The Judge's answer: none it could read, so there is nothing to accept with Enter.");
    expect(prompt.some((line) => line.startsWith("  Enter"))).toBe(false);
  });

  it("reads Enter as the Judge's answer, and a or b as the maintainer's own over it", () => {
    expect(parseTier("", judgeSays("answer"))).toEqual({ kind: "tier", tier: "answer" });
    expect(parseTier("  ", judgeSays("bonus", "high"))).toEqual({ kind: "tier", tier: "bonus" });
    expect(parseTier("b", judgeSays("answer"))).toEqual({ kind: "tier", tier: "bonus" });
    expect(parseTier("a", judgeSays("bonus"))).toEqual({ kind: "tier", tier: "answer" });
    expect(parseTier("s", judgeSays("answer"))).toEqual({ kind: "unruled" });
    // No answer from the Judge leaves Enter nothing to accept.
    expect(parseTier("", judgeSays("no-ruling", "low"))).toBeNull();
  });

  it("counts how often the maintainer's ruling agreed with the Judge's answer, over the words both answered", () => {
    expect(tierAgreement([
      { judge: judgeSays("answer"), decision: { kind: "tier", tier: "answer" } },
      { judge: judgeSays("bonus"), decision: { kind: "tier", tier: "answer" } },
      { judge: judgeSays("bonus", "high"), decision: { kind: "tier", tier: "bonus" } },
      // A word skipped, and one the Judge gave no answer on, are counted apart and agree with nothing.
      { judge: judgeSays("answer"), decision: { kind: "unruled" } },
      { judge: judgeSays("no-ruling", "low"), decision: { kind: "tier", tier: "bonus" } },
      { decision: { kind: "tier", tier: "bonus" } },
    ])).toEqual({ words: 6, compared: 3, agreed: 2, rate: 2 / 3, byConfidence: { high: [1, 1], medium: [1, 2], low: [0, 0] } });
    expect(tierAgreement([])).toEqual({ words: 0, compared: 0, agreed: 0, rate: null, byConfidence: { high: [0, 0], medium: [0, 0], low: [0, 0] } });
  });

  it("accepts every command it names", () => {
    for (const judge of [undefined, judgeSays("answer"), judgeSays("bonus"), judgeSays("no-ruling", "low")]) {
      const commands = tierPrompt(throwdown, judge).filter((line) => /^ {2}\S/.test(line));
      expect(commands.length).toBeGreaterThan(0);
      for (const line of commands) {
        const typed = line.trim().split(/\s{2,}/)[0]!;
        expect(parseTier(typed === "Enter" ? "" : typed, judge), line).not.toBeNull();
      }
    }
  });
});

describe("asking the maintainer to keep a written-in word that scores, or make it a Bonus Word (#319)", () => {
  const afterschool: WrittenInAnswer = { word: "afterschool", seedWord: "cool", rhymeKey: "UW L", knownness: 1.33 };

  it("says why it is asked, names the Seed Word, says it is waiting, and gives one command a line with its effect", () => {
    expect(writtenInAnswerPrompt(afterschool, 0.5)).toEqual([
      "Its knownness is 1.33, at or above the Answer line of 0.50, so it scores as an Answer, and nobody has looked at it.",
      "Would an ordinary player think of afterschool when hunting rhymes for cool?",
      "Waiting for your Tier ruling on this word. Type one of these and press Enter:",
      "  Enter                keep it an Answer, as it is: nothing is written",
      "  a                    the same as Enter",
      "  b                    Bonus Word: an unlocked Tier verdict is written to data/tier-overrides.csv, so it stays accepted and unscored from the next build",
    ]);
  });

  it("reads Enter, or a, as keeping the Answer, and b as a Bonus Word", () => {
    expect(parseWrittenInAnswer("")).toEqual({ kind: "leave" });
    expect(parseWrittenInAnswer(" A ")).toEqual({ kind: "leave" });
    expect(parseWrittenInAnswer("b")).toEqual({ kind: "tier", tier: "bonus" });
  });

  it("reads nothing it cannot act on, so the caller asks again and writes nothing", () => {
    expect(parseWrittenInAnswer("a b")).toBeNull();
    expect(parseWrittenInAnswer("bonus")).toBeNull();
    // Other items' commands are not this one's.
    expect(parseWrittenInAnswer("s")).toBeNull();
    expect(parseWrittenInAnswer("l")).toBeNull();
    expect(parseWrittenInAnswer("d")).toBeNull();
  });

  it("accepts every command it names", () => {
    const commands = writtenInAnswerPrompt(afterschool, 0.5).filter((line) => /^ {2}\S/.test(line));
    for (const line of commands) {
      const typed = line.trim().split(/\s{2,}/)[0]!;
      expect(parseWrittenInAnswer(typed === "Enter" ? "" : typed), line).not.toBeNull();
    }
  });
});
