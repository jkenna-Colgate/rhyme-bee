/**
 * The Echo test (#315, ADR-0008 amended 2026-11-12): a Daily Puzzle with no
 * native Answer, more than half of whose Answers are derived from words in
 * other scheduled Puzzles. Small hand-built families throughout, so each
 * verdict can be read off the words in the test.
 */

import { describe, expect, it } from "vitest";
import { Derivation, IndexDataSource } from "../derivation.ts";
import { derivedFrom, echoesIn, echoLines, testEcho, type EchoLexicon, type EchoPuzzle } from "../echo.ts";
import { rhymeKeyOf, type Pronunciation } from "../phonology.ts";

/** A lexicon over `readings`, every word in it holding wordhood. */
function lexicon(readings: Record<string, string | string[]>): EchoLexicon {
  const pronunciations = new Map<string, Pronunciation[]>(
    Object.entries(readings).map(([w, r]) => [w, (Array.isArray(r) ? r : [r]).map((p) => p.split(" "))]),
  );
  const words = new Set(pronunciations.keys());
  return {
    derivation: new Derivation(new IndexDataSource({ words, pronunciations })),
    hasWord: (w) => words.has(w),
    rhymeKeysOf: (w) => [...new Set((pronunciations.get(w) ?? []).map((p) => rhymeKeyOf(p)!))],
  };
}

const puzzle = (date: string, seedWord: string, rhymeKey: string, answers: string[]): EchoPuzzle => ({
  date,
  seedWord,
  rhymeKey,
  answers,
});

describe("testEcho", () => {
  it("finds an Echo: no native Answer, and most Answers derived from another day's words", () => {
    const lex = lexicon({
      air: "EH1 R", chair: "CH EH1 R", stair: "S T EH1 R", flair: "F L EH1 R",
      airs: "EH1 R Z", chairs: "CH EH1 R Z", stairs: "S T EH1 R Z", flairs: "F L EH1 R Z",
    });
    const air = puzzle("2026-11-02", "air", "EH R", ["chair", "stair", "flair"]);
    const airs = puzzle("2026-11-03", "airs", "EH R Z", ["chairs", "stairs", "flairs"]);

    expect(testEcho(airs, [air], lex)).toEqual({
      echo: true,
      native: [],
      share: 1,
      echoed: [{ date: "2026-11-02", seedWord: "air", rhymeKey: "EH R", share: 1 }],
    });
  });

  describe("needs both parts (decision 2)", () => {
    const lex = lexicon({
      ship: "SH IH1 P", lip: "L IH1 P", tip: "T IH1 P", hip: "HH IH1 P",
      eclipse: "IH0 K L IH1 P S", ellipse: "IH0 L IH1 P S",
      ships: "SH IH1 P S", lips: "L IH1 P S", tips: "T IH1 P S", hips: "HH IH1 P S",
      glide: "G L AY1 D", guide: "G AY1 D", glided: "G L AY1 D IH0 D", guided: "G AY1 D IH0 D",
      chided: "CH AY1 D IH0 D", chide: "CH AY1 D",
    });
    const ship = puzzle("2026-11-02", "ship", "IH P", ["lip", "tip", "hip"]);

    it("is no Echo with a native Answer, however much it restates", () => {
      const eclipse = puzzle("2026-11-03", "eclipse", "IH P S", ["ellipse", "ships", "lips", "tips", "hips"]);
      const test = testEcho(eclipse, [ship], lex);
      expect(test).toMatchObject({ echo: false, native: ["ellipse"], share: 0.8 });
    });

    it("is no Echo when its derived Answers come from words no day holds", () => {
      const lopsided = puzzle("2026-11-04", "lopsided", "AY D IH D", ["glided", "guided", "chided"]);
      expect(testEcho(lopsided, [ship], lex)).toEqual({ echo: false, native: [], share: 0, echoed: [] });
    });
  });

  it("counts the share against all the other days together (decision 3)", () => {
    const lex = lexicon({
      port: "P AO1 R T", fort: "F AO1 R T", sort: "S AO1 R T",
      bid: "B IH1 D", kid: "K IH1 D", lid: "L IH1 D",
      sordid: "S AO1 R D IH0 D", ported: "P AO1 R T IH0 D", sorted: "S AO1 R T IH0 D",
      kidded: "K IH1 D IH0 D", lidded: "L IH1 D IH0 D", chide: "CH AY1 D", chided: "CH AY1 D IH0 D",
    });
    const port = puzzle("2026-11-02", "port", "AO R T", ["fort", "sort"]);
    const bid = puzzle("2026-11-03", "bid", "IH D", ["kid", "lid"]);
    // Two of five from `port` and two of five from `bid`: neither day alone is
    // more than half, and together they are four in five. (The words are made
    // to share a key here; the test reads the derivations, not the sounds.)
    const sordid = puzzle("2026-11-04", "sordid", "AO R D IH D", ["ported", "sorted", "kidded", "lidded", "chided"]);
    const test = testEcho(sordid, [port, bid], lex);
    expect(test.echo).toBe(true);
    expect(test.share).toBe(0.8);
    expect(test.echoed).toEqual([
      { date: "2026-11-02", seedWord: "port", rhymeKey: "AO R T", share: 0.4 },
      { date: "2026-11-03", seedWord: "bid", rhymeKey: "IH D", share: 0.4 },
    ]);
  });

  describe("counting", () => {
    const lex = lexicon({
      skirt: "S K ER1 T", dirt: "D ER1 T", flirt: "F L ER1 T", shirt: "SH ER1 T",
      hertz: "HH ER1 T S", dirts: "D ER1 T S", flirts: "F L ER1 T S", shirts: "SH ER1 T S",
      // Derived from a word on a key no day holds.
      curse: "K ER1 S", curses: "K ER1 S IH0 Z",
    });
    const skirt = puzzle("2026-11-02", "skirt", "ER T", ["dirt", "flirt", "shirt"]);

    it("does not let a native Seed Word save the day, since the Seed Word is given (decision 4)", () => {
      const hertz = puzzle("2026-11-03", "hertz", "ER T S", ["dirts", "flirts", "shirts"]);
      expect(testEcho(hertz, [skirt], lex)).toMatchObject({ echo: true, native: [], share: 1 });
    });

    it("needs more than half: exactly half is no Echo", () => {
      // `dirts` from `skirt`'s day, `curses` from `curse`, which no day holds.
      const even = puzzle("2026-11-03", "hertz", "ER T S", ["dirts", "curses"]);
      expect(testEcho(even, [skirt], lex)).toMatchObject({ echo: false, share: 0.5 });
    });

    it("counts an Answer once however many days hold its stem", () => {
      const dirt = puzzle("2026-11-04", "dirt", "ER T", ["skirt", "flirt", "shirt"]);
      const hertz = puzzle("2026-11-03", "hertz", "ER T S", ["dirts", "curses"]);
      expect(testEcho(hertz, [skirt, dirt], lex)).toMatchObject({ echo: false, share: 0.5 });
    });
  });

  describe("reads derived more widely than the build's detector (decision 5)", () => {
    const lex = lexicon({
      bone: "B OW1 N", loan: "L OW1 N", stone: "S T OW1 N", cross: "K R AO1 S",
      bones: "B OW1 N Z", loans: "L OW1 N Z", stones: "S T OW1 N Z", crossbones: "K R AO1 S B OW2 N Z",
      essential: "IH0 S EH1 N SH AH0 L", potential: "P AH0 T EH1 N SH AH0 L",
      essentially: "IH0 S EH1 N SH AH0 L IY0", potentially: "P AH0 T EH1 N SH AH0 L IY0",
      car: "K AA1 R", pet: "P EH1 T", carpet: "K AA1 R P AH0 T", carpets: "K AA1 R P AH0 T S",
    });
    const loan = puzzle("2026-11-02", "loan", "OW N", ["bone", "stone"]);

    it("reads a compound whose last part is derived as derived from that part's stem", () => {
      expect(derivedFrom("crossbones", lex)).toEqual(["bone"]);
      const day = puzzle("2026-11-03", "loans", "OW N Z", ["crossbones", "bones", "stones"]);
      expect(testEcho(day, [loan], lex)).toMatchObject({ echo: true, native: [], share: 1 });
    });

    it("splits a compound only where the last part is derived: `carpet` is no `car` + `pet`", () => {
      expect(derivedFrom("carpet", lex)).toEqual([]);
      expect(derivedFrom("carpets", lex)).toEqual(["carpet"]);
    });

    it("reads a configured derivational suffix as derived", () => {
      expect(derivedFrom("essentially", lex)).toEqual(["essential"]);
      const potential = puzzle("2026-11-02", "potential", "EH N SH AH L", ["essential"]);
      const day = puzzle("2026-11-03", "essentially", "EH N SH AH L IY", ["potentially"]);
      expect(testEcho(day, [potential], lex)).toMatchObject({ echo: true, native: [], share: 1 });
    });

    it("leaves the build's own detector as it was (decision 6)", () => {
      expect(lex.derivation.isDerived("essentially")).toBe(false);
      expect(lex.derivation.isDerived("crossbones")).toBe(false);
    });
  });

  describe("never counts the Puzzle's own Rhyme Key as another day", () => {
    // An appending Normalisation files one family under two key spellings.
    const lex = lexicon({
      hire: ["HH AY1 ER0", "HH AY1 R"], fire: ["F AY1 ER0", "F AY1 R"],
      rehire: ["R IY0 HH AY1 ER0", "R IY0 HH AY1 R"], refire: ["R IY0 F AY1 ER0", "R IY0 F AY1 R"],
    });

    it("on its own key", () => {
      const hire = puzzle("2026-11-02", "hire", "AY ER", ["rehire", "refire"]);
      const fire = puzzle("2026-11-09", "fire", "AY ER", ["rehire", "hire"]);
      expect(testEcho(hire, [fire], lex)).toMatchObject({ echo: false, share: 0, echoed: [] });
    });

    it("under another spelling of it, which holds the same Puzzle", () => {
      const hire = puzzle("2026-11-02", "hire", "AY ER", ["rehire", "refire"]);
      const sameWords = puzzle("2026-11-09", "rehire", "AY R", ["hire", "refire"]);
      expect(testEcho(hire, [sameWords], lex)).toMatchObject({ echo: false, share: 0, echoed: [] });
    });
  });

  it("counts a stem with several Rhyme Keys as restated if any of them is scheduled", () => {
    const lex = lexicon({
      tear: ["T EH1 R", "T IH1 R"], beer: "B IH1 R", deer: "D IH1 R",
      tears: ["T EH1 R Z", "T IH1 R Z"], beers: "B IH1 R Z", piers: "P IH1 R Z", pier: "P IH1 R",
    });
    const beer = puzzle("2026-11-02", "beer", "IH R", ["deer", "pier"]);
    const beers = puzzle("2026-11-03", "beers", "IH R Z", ["tears", "piers"]);
    // `tear` is read on EH R as well, and no day holds EH R; IH R is enough.
    expect(testEcho(beers, [beer], lex)).toMatchObject({ echo: true, share: 1 });
  });
});

describe("echoesIn", () => {
  const lex = lexicon({
    air: "EH1 R", chair: "CH EH1 R", stair: "S T EH1 R",
    airs: "EH1 R Z", chairs: "CH EH1 R Z", stairs: "S T EH1 R Z",
    aired: "EH1 R D", chaired: "CH EH1 R D", stared: "S T EH1 R D", stare: "S T EH1 R",
    quite: "K W AY1 T", sight: "S AY1 T", bite: "B AY1 T", short: "SH AO1 R T",
    shortsighted: "SH AO1 R T S AY1 T IH0 D", sighted: "S AY1 T IH0 D",
  });

  it("reports every day that echoes the others, and not the day they echo", () => {
    const days = [
      puzzle("2026-11-02", "air", "EH R", ["chair", "stair"]),
      puzzle("2026-11-03", "airs", "EH R Z", ["chairs", "stairs"]),
      puzzle("2026-11-04", "aired", "EH R D", ["chaired", "stared"]),
    ];
    expect(echoesIn(days, lex).map((e) => e.seedWord)).toEqual(["airs", "aired"]);
  });

  it("reports a scheduled day that a newcomer makes into an Echo", () => {
    const shortsighted = puzzle("2026-11-25", "shortsighted", "AY T IH D", ["sighted"]);
    expect(echoesIn([shortsighted], lex)).toEqual([]);
    const quite = puzzle("2026-11-26", "quite", "AY T", ["sight", "bite"]);
    expect(echoesIn([shortsighted, quite], lex)).toMatchObject([
      { date: "2026-11-25", seedWord: "shortsighted", echoed: [{ seedWord: "quite", share: 1 }] },
    ]);
  });
});

describe("echoLines", () => {
  const lex = lexicon({
    air: "EH1 R", chair: "CH EH1 R", stair: "S T EH1 R",
    airs: "EH1 R Z", chairs: "CH EH1 R Z", stairs: "S T EH1 R Z",
  });
  const air = puzzle("2026-11-02", "air", "EH R", ["chair", "stair"]);
  const airs = puzzle("2026-11-03", "airs", "EH R Z", ["chairs", "stairs"]);

  it("says so in one line when nothing echoes", () => {
    expect(echoLines([])).toEqual(["Echoes: no scheduled day echoes another."]);
  });

  it("names each Echo with its date, Seed Word, share and the days it echoes", () => {
    expect(echoLines(echoesIn([air, airs], lex)).slice(1)).toEqual([
      "  2026-11-03 airs on EH R Z: 100% restated, from air 2026-11-02 100%",
    ]);
  });

  it("says which Echoes a change made: a newcomer that echoes, or a day a newcomer echoes", () => {
    expect(echoLines(echoesIn([air, airs], lex), { joining: ["2026-11-03"], before: [] })[1]).toMatch(/\(joining\)$/);
    expect(echoLines(echoesIn([air, airs], lex), { joining: ["2026-11-02"], before: [] })[1]).toMatch(
      /\(made an Echo by a day joining\)$/,
    );
  });

  it("does not credit a change with an Echo that was there before it", () => {
    // `air` swapped for another Seed Word on its own key: `airs` echoed it already.
    const before = echoesIn([air, airs], lex);
    const lines = echoLines(echoesIn([{ ...air, seedWord: "chair", answers: ["air", "stair"] }, airs], lex), {
      joining: ["2026-11-02"],
      before,
    });
    expect(lines[1]).toBe("  2026-11-03 airs on EH R Z: 100% restated, from chair 2026-11-02 100%");
  });
});
