import { describe, expect, it } from "vitest";
import { RhymeIndex } from "../../src/rhymeIndex.ts";
import {
  formatFamilyLookup,
  formatWordLookup,
  LOOKUP_HELP,
  lookUpFamily,
  lookUpWord,
  parseLookupArgs,
  type BuildProvenance,
  type WordLookup,
} from "../indexLookup.ts";

describe("lookUpWord", () => {
  const P = (s: string) => s.split(" ");
  const index = new RhymeIndex(
    {
      pronunciations: new Map([
        ["tear", [P("T EH1 R"), P("T IH1 R")]],
        ["gruel", [P("G R UW1 AH0 L"), P("G R UW1 L")]],
        ["gruels", [P("G R UW1 AH0 L Z")]],
        ["onyx", [P("AA1 N IH0 K S")]],
        ["marx", [P("M AA1 R K S")]],
      ]),
      words: new Set(["tear", "gruel", "gruels", "onyx", "founds"]),
      names: new Set(["marx"]),
      prevalence: new Map([["tear", 0.99]]),
    },
    { knownnessThreshold: 0.9 },
  );
  const provenance: BuildProvenance = {
    supplemented: new Set(["onyx"]),
    derived: new Map([["gruels", { stem: "gruel", rule: "inflection:s" }]]),
    demotions: new Map([["marx", "proper-noun"]]),
  };

  it("reads every pronunciation, its Rhyme Key and its Tier off the index", () => {
    const tear = lookUpWord(index, "tear", provenance);
    expect(tear.readings.map((r) => r.rhymeKey)).toEqual(["EH R", "IH R"]);
    expect(tear.readings.map((r) => r.source)).toEqual([{ kind: "cmudict" }, { kind: "cmudict" }]);
    expect(tear).toMatchObject({ inWordList: true, isName: false, demotion: null, tier: "answer", knownness: 0.99 });
  });

  it("traces each reading to the supplement, a derivation or Normalisation", () => {
    expect(lookUpWord(index, "onyx", provenance).readings[0]!.source).toEqual({ kind: "supplement" });
    expect(lookUpWord(index, "gruels", provenance).readings[0]!.source).toEqual({
      kind: "derived",
      stem: "gruel",
      rule: "inflection:s",
    });
    expect(lookUpWord(index, "gruel", provenance).readings.map((r) => r.source.kind)).toEqual([
      "cmudict",
      "normalisation",
    ]);
  });

  it("reports a Demotion and the names data", () => {
    expect(lookUpWord(index, "marx", provenance)).toMatchObject({
      inWordList: false,
      isName: true,
      demotion: "proper-noun",
    });
  });

  it("gives a word with no pronunciation no readings", () => {
    expect(lookUpWord(index, "founds", provenance).readings).toEqual([]);
  });
});

describe("lookUpFamily", () => {
  it("reads a Rhyme Key's members and their Tiers off the index", () => {
    const index = new RhymeIndex(
      {
        pronunciations: new Map([
          ["beer", ["B", "IH1", "R"]],
          ["bier", ["B", "IH1", "R"]],
          ["bear", ["B", "EH1", "R"]],
        ].map(([w, p]) => [w as string, [p as string[]]])),
        words: new Set(["beer", "bier", "bear"]),
        names: new Set(),
        prevalence: new Map([["beer", 0.99]]),
      },
      { knownnessThreshold: 0.9 },
    );
    expect(lookUpFamily(index, "IH R")).toEqual({
      rhymeKey: "IH R",
      members: [
        { word: "beer", tier: "answer" },
        { word: "bier", tier: "bonus" },
      ],
      mergedKeys: [],
    });
  });
});

describe("parseLookupArgs", () => {
  it("reads bare arguments as words to look up", () => {
    expect(parseLookupArgs(["tear", "Marx"])).toEqual({ kind: "words", words: ["tear", "marx"] });
  });

  it("reads --key as a Rhyme Key, in either spelling, ignoring stress and case", () => {
    expect(parseLookupArgs(["--key", "ih1 r"])).toEqual({ kind: "key", rhymeKey: "IH R" });
    expect(parseLookupArgs(["--key=IH R"])).toEqual({ kind: "key", rhymeKey: "IH R" });
  });

  it("joins an unquoted key's sounds, which a shell splits into separate arguments", () => {
    expect(parseLookupArgs(["--key", "EY", "T"])).toEqual({ kind: "key", rhymeKey: "EY T" });
  });

  it("asks for help on --help or on no arguments at all", () => {
    expect(parseLookupArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseLookupArgs([])).toEqual({ kind: "help" });
  });

  it("refuses an unknown flag and an empty key", () => {
    expect(() => parseLookupArgs(["--seed", "book"])).toThrow(/Unknown argument/);
    expect(() => parseLookupArgs(["--key"])).toThrow(/--key needs/);
  });
});

describe("LOOKUP_HELP", () => {
  it("describes both forms", () => {
    expect(LOOKUP_HELP).toMatch(/<word>/);
    expect(LOOKUP_HELP).toMatch(/--key/);
  });
});

const tear: WordLookup = {
  word: "tear",
  readings: [
    { pronunciation: ["T", "EH1", "R"], respelling: "TEHR", rhymeKey: "EH R", source: { kind: "cmudict" } },
    { pronunciation: ["T", "IH1", "R"], respelling: "TIHR", rhymeKey: "IH R", source: { kind: "cmudict" } },
  ],
  inWordList: true,
  isName: false,
  demotion: null,
  tier: "answer",
  knownness: 0.99,
};

describe("formatWordLookup", () => {
  it("shows every reading with its Rhyme Key in ARPAbet and IPA", () => {
    const out = formatWordLookup(tear);
    expect(out).toContain("T EH1 R");
    expect(out).toContain("T IH1 R");
    expect(out).toContain("EH R /ɛr/");
    expect(out).toContain("IH R /ɪr/");
  });

  it("names the source of each reading", () => {
    const out = formatWordLookup({
      ...tear,
      word: "gruels",
      readings: [
        { pronunciation: ["G", "R", "UW1", "AH0", "L", "Z"], respelling: "GROO-uhlz", rhymeKey: "UW AH L Z", source: { kind: "derived", stem: "gruel", rule: "inflection:s" } },
        { pronunciation: ["G", "R", "UW1", "L", "Z"], respelling: "GROOLZ", rhymeKey: "UW L Z", source: { kind: "normalisation" } },
      ],
    });
    const lineOf = (pron: string) => out.split("\n").find((line) => line.includes(pron));
    const derived = lineOf("G R UW1 AH0 L Z");
    const generated = lineOf("G R UW1 L Z");
    expect(derived).toContain("derived from gruel (inflection:s)");
    expect(generated).toContain("appended by Normalisation");
    expect(formatWordLookup(tear)).toContain("CMUdict");
  });

  it("gives a word with wordhood its Tier and knownness", () => {
    const out = formatWordLookup(tear);
    expect(out).toContain("Answer");
    expect(out).toContain("knownness 0.99");
    expect(out).toContain("word list: yes");
    expect(out).toContain("names: no");
    expect(out).toContain("demoted: no");
  });

  it("says a demoted word is demoted, and gives it no Tier", () => {
    const out = formatWordLookup({
      ...tear,
      word: "marx",
      readings: [{ pronunciation: ["M", "AA1", "R", "K", "S"], respelling: "MAHRKS", rhymeKey: "AA R K S", source: { kind: "cmudict" } }],
      inWordList: false,
      isName: true,
      demotion: "proper-noun",
      tier: "bonus",
      knownness: null,
    });
    expect(out).toContain("demoted: yes (proper-noun)");
    expect(out).toContain("word list: no");
    expect(out).toContain("names: yes");
    expect(out).not.toMatch(/Answer|Bonus Word/);
  });

  it("says so when the index holds no pronunciation for the word", () => {
    const out = formatWordLookup({ ...tear, word: "founds", readings: [] });
    expect(out).toContain("no pronunciation");
  });
});

describe("formatFamilyLookup", () => {
  it("lists the family under each Tier, with counts", () => {
    const out = formatFamilyLookup({
      rhymeKey: "IH R",
      members: [
        { word: "beer", tier: "answer" },
        { word: "cheer", tier: "answer" },
        { word: "bier", tier: "bonus" },
      ],
      mergedKeys: [],
    });
    expect(out).toContain("IH R /ɪr/");
    expect(out).toContain("Answers (2): beer, cheer");
    expect(out).toContain("Bonus Words (1): bier");
  });

  it("names a Schwa Twin merged into the family", () => {
    const out = formatFamilyLookup({
      rhymeKey: "EH K SH AH N",
      members: [{ word: "section", tier: "answer" }],
      mergedKeys: ["EH K SH N"],
    });
    expect(out).toContain("also matches EH K SH N");
  });

  it("says so when no word has the Rhyme Key", () => {
    const out = formatFamilyLookup({ rhymeKey: "ZH ZH", members: [], mergedKeys: [] });
    expect(out).toContain("no word in the index has this Rhyme Key");
  });
});
