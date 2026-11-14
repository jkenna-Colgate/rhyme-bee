/**
 * Normalisation Exceptions (#323), through the whole manufacture: a line takes
 * one reading Normalisation appended off one word, and nothing else.
 *
 * `flower` is written `F L AW1 ER0` and the glide-r rule appends `F L AW1 R`,
 * which is what puts it in `scour`'s family. `tear` holds two readings the
 * dictionary wrote, and `caught` one the cot-caught merger replaced.
 */

import { describe, expect, it } from "vitest";
import { manufactureIndexData } from "../manufacture.ts";
import {
  parseNormalisationExceptions,
  serialiseNormalisationException,
} from "../normalisationExceptions.ts";
import { RhymeIndex } from "../rhymeIndex.ts";

const CMUDICT = [
  "FLOWER  F L AW1 ER0",
  "POWER  P AW1 ER0",
  "SCOUR  S K AW1 R",
  "TEAR  T IH1 R",
  "TEAR(1)  T EH1 R",
  "CAUGHT  K AO1 T",
  "VAMPIRE  V AE1 M P AY0 R",
  "BAPTISM  B AE1 P T IH0 Z AH0 M",
  "ARTICLE  AA1 R T AH0 K AH0 L",
  "ARTICLE(1)  AA1 R T IH0 K AH0 L",
].join("\n");

function build(exceptions?: string) {
  const built = manufactureIndexData({
    cmudict: CMUDICT,
    words: "flower\npower\nscour\ntear\ncaught\nvampire\nbaptism\narticle",
    names: "",
    prevalence: "Word,Prevalence\nflower,2.4\npower,2.4\nscour,2.0",
    demotions: "",
    supplement: "",
    tierOverrides: "",
    unconfirmedRhymes: "",
    ...(exceptions === undefined ? {} : { normalisationExceptions: exceptions }),
  });
  const index = new RhymeIndex(built.data, { knownnessThreshold: 1 });
  const readings = (word: string) => index.readingsOf(word).map((r) => r.pronunciation.join(" "));
  return { ...built, index, readings };
}

describe("a Normalisation Exception in the build", () => {
  it("changes nothing when there is no line", () => {
    const none = build();
    const empty = build("# no exceptions yet\n\n");

    expect(none.readings("flower")).toEqual(["F L AW1 ER0", "F L AW1 R"]);
    expect(empty.data.pronunciations).toEqual(none.data.pronunciations);
    expect(empty.data.unmergedReadings).toEqual(none.data.unmergedReadings);
    expect(empty.excepted).toEqual({ applied: [], refused: [], stale: [], malformed: [] });
  });

  it("takes exactly the appended reading named, from that word alone", () => {
    const { readings, excepted, index } = build("flower F L AW1 R\n");

    expect(readings("flower")).toEqual(["F L AW1 ER0"]);
    expect(readings("power")).toEqual(["P AW1 ER0", "P AW1 R"]);
    expect(excepted.applied).toEqual([{ word: "flower", reading: "F L AW1 R".split(" ") }]);
    // The key only the excepted reading gave it: flower is out of scour's family, power is still in.
    expect(index.rhymeKeysOf("flower")).toEqual(["AW ER"]);
    expect(index.rhymeKeysOf("power")).toContain("AW R");
  });

  it("refuses a reading the word was given directly, and builds as if the line were absent", () => {
    const { readings, excepted } = build("tear T EH1 R\nflower F L AW1 ER0\n");

    expect(readings("tear")).toEqual(["T IH1 R", "T EH1 R"]);
    expect(readings("flower")).toEqual(["F L AW1 ER0", "F L AW1 R"]);
    expect(excepted.applied).toEqual([]);
    expect(excepted.refused.map((r) => `${r.word}: ${r.reason}`)).toEqual(["tear: not-appended", "flower: not-appended"]);
  });

  it("refuses a reading a replacing rule produced, which is the word's only reading", () => {
    const { readings, excepted } = build("caught K AA1 T\n");

    expect(readings("caught")).toEqual(["K AA1 T"]);
    expect(excepted.refused.map((r) => `${r.word}: ${r.reason}`)).toEqual(["caught: only-reading"]);
  });

  it("reports a line whose reading the word does not hold as stale", () => {
    const { excepted, readings } = build("flower F L AW1 Z\nnosuchword N OW1\n");

    expect(readings("flower")).toEqual(["F L AW1 ER0", "F L AW1 R"]);
    expect(excepted.stale.map((s) => s.word)).toEqual(["flower", "nosuchword"]);
  });

  it("reports a line that does not read and carries on", () => {
    const { excepted, readings } = build("flower\nflower F L AW1 R\npower P AW1 r?\n");

    expect(excepted.malformed).toEqual(["flower", "power P AW1 r?"]);
    expect(readings("flower")).toEqual(["F L AW1 ER0"]);
  });

  it("takes an appended reading and one appended to it, both named", () => {
    // Stress promotion appends `AY2 R` to vampire, and glide-r appends `AY2 ER0` to that.
    const before = build();
    expect(before.readings("vampire")).toEqual(["V AE1 M P AY0 R", "V AE1 M P AY2 R", "V AE1 M P AY2 ER0"]);

    const { readings, excepted } = build("vampire V AE1 M P AY2 R\nvampire V AE1 M P AY2 ER0\n");

    expect(readings("vampire")).toEqual(["V AE1 M P AY0 R"]);
    expect(excepted.refused).toEqual([]);
    expect(excepted.applied).toHaveLength(2);
  });

  it("takes the reading a Weak Rhyme is worked out from as well", () => {
    // The weak-vowel merge rewrites baptism, so the index keeps its unmerged readings apart, place for place.
    const before = build();
    expect(before.readings("baptism")).toEqual(["B AE1 P T AH0 Z AH0 M", "B AE1 P T AH0 Z M"]);
    expect(before.index.unmergedReadingsOf("baptism").map((r) => r.join(" "))).toEqual(["B AE1 P T IH0 Z AH0 M", "B AE1 P T IH0 Z M"]);

    const { index, readings } = build("baptism B AE1 P T AH0 Z M\n");

    expect(readings("baptism")).toEqual(["B AE1 P T AH0 Z AH0 M"]);
    expect(index.unmergedReadingsOf("baptism").map((r) => r.join(" "))).toEqual(["B AE1 P T IH0 Z AH0 M"]);
  });

  it("takes every unmerged reading the merge collapsed into the excepted one", () => {
    // The dictionary writes article with either weak vowel; the merge makes them one reading and one variant,
    // and the unmerged list still holds a variant of each.
    const before = build();
    expect(before.readings("article")).toEqual(["AA1 R D AH0 K AH0 L", "AA1 R D AH0 K L"]);
    expect(before.index.unmergedReadingsOf("article")).toHaveLength(4);

    const { index, readings } = build("article AA1 R D AH0 K L\n");

    expect(readings("article")).toEqual(["AA1 R D AH0 K AH0 L"]);
    expect(index.unmergedReadingsOf("article").map((r) => r.join(" "))).toEqual(["AA1 R D AH0 K AH0 L", "AA1 R D IH0 K AH0 L"]);
  });
});

describe("the Normalisation Exception file format", () => {
  it("reads back the line it writes, and ignores comments and blanks", () => {
    const line = serialiseNormalisationException({ word: "Flower", reading: ["F", "L", "AW1", "R"] });

    expect(line).toBe("flower F L AW1 R\n");
    expect(parseNormalisationExceptions(`# a gloss\n\n${line}power P AW1 R  # why\n`)).toEqual({
      entries: [
        { word: "flower", reading: ["F", "L", "AW1", "R"] },
        { word: "power", reading: ["P", "AW1", "R"] },
      ],
      malformed: [],
    });
  });
});
