/**
 * The schwa before a word-final `L`, `N` or `M` is optional in ordinary General
 * American — `gruel` is two syllables in the data and one out of most mouths —
 * so normalisation gives a reading that carries it a second reading without it
 * (ADR-0010).
 *
 * The rule *appends*, so it can only ever turn a rejection into an acceptance —
 * every reading the index had before is still there, still first. That is what
 * makes it safe to state as a claim about the ear rather than about the data.
 *
 * These tests assert a reading or a verdict, never the rule's internals.
 */

import { describe, expect, it } from "vitest";
import { applyNormalisation } from "../normalise.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";
import { isAccepted } from "../verdict.ts";

function target(entries: [string, Pronunciation[]][] = []) {
  return { pronunciations: new Map(entries) };
}

describe("a schwa before a word-final L, N or M", () => {
  it("gains a reading with the L syllabic, keeping the base reading first", () => {
    const data = target([["gruel", [["G", "R", "UW1", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("gruel")).toEqual([
      ["G", "R", "UW1", "AH0", "L"],
      ["G", "R", "UW1", "L"],
    ]);
  });

  it("gains a reading with the N syllabic", () => {
    const data = target([["ribbon", [["R", "IH1", "B", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ribbon")).toContainEqual(["R", "IH1", "B", "N"]);
  });

  it("gains a reading with the M syllabic", () => {
    const data = target([["album", [["AE1", "L", "B", "AH0", "M"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("album")).toContainEqual(["AE1", "L", "B", "M"]);
  });

  it("appends variants after every base reading, in the order they arrived", () => {
    // Load-bearing: a Seed Word is spoken and respelled in its first reading, so
    // a variant must never displace the reading the data actually asserts.
    const data = target([
      ["duel", [["D", "UW1", "AH0", "L"], ["D", "Y", "UW1", "AH0", "L"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("duel")).toEqual([
      ["D", "UW1", "AH0", "L"],
      ["D", "Y", "UW1", "AH0", "L"],
      ["D", "UW1", "L"],
      ["D", "Y", "UW1", "L"],
    ]);
  });

  it("collapses a variant the data already lists", () => {
    // Some words arrive from CMUdict with both readings. The rule derives one
    // that is already there, and a duplicate reading would sit in the map
    // forever without ever mattering.
    const data = target([["duel", [["D", "UW1", "AH0", "L"], ["D", "UW1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("duel")).toEqual([
      ["D", "UW1", "AH0", "L"],
      ["D", "UW1", "L"],
    ]);
  });
});

describe("the vowels the rule must not drop", () => {
  it("leaves a stressed final vowel alone, so a Rhyme Key keeps its anchor", () => {
    const data = target([["annul", [["AH0", "N", "AH1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("annul")).toEqual([["AH0", "N", "AH1", "L"]]);
  });

  it("leaves a full unstressed vowel alone — only a schwa is reducible", () => {
    const data = target([["crayon", [["K", "R", "EY1", "AA0", "N"]]]]);
    applyNormalisation(data);

    // Stated as "the vowel is still there" rather than as the whole reading
    // list, because stress promotion (issue #73) appends a reading that marks
    // that vowel `AA2`. What *this* rule must never do is delete it.
    expect(data.pronunciations.get("crayon")?.[0]).toEqual(["K", "R", "EY1", "AA0", "N"]);
    expect(data.pronunciations.get("crayon")).not.toContainEqual(["K", "R", "EY1", "N"]);
  });

  it("leaves a schwa before any other consonant alone", () => {
    // The `-ate` guardrail lives here: no sonorant follows, so nothing is
    // syllabic and the schwa is the whole audible contrast.
    const data = target([["private", [["P", "R", "AY1", "V", "AH0", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("private")).toEqual([
      ["P", "R", "AY1", "V", "AH0", "T"],
    ]);
  });

  it("leaves a word-internal schwa alone, even before an L", () => {
    // `chocolate`: the schwa in `-co-la-` is not syllable-final, and dropping it
    // is a different claim about a different speech habit.
    const data = target([
      ["chocolate", [["CH", "AA1", "K", "AH0", "L", "AH0", "T"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("chocolate")).toEqual([
      ["CH", "AA1", "K", "AH0", "L", "AH0", "T"],
    ]);
  });

  it("leaves a reading whose only vowel is that schwa alone", () => {
    // Nothing would remain to anchor a Rhyme Key, so the variant would be a
    // reading the index could never match on.
    const data = target([["an", [["AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("an")).toEqual([["AH0", "N"]]);
  });
});

describe("a normalised index adjudicates against the Seed Word `cool`", () => {
  const index = makeTestIndex();
  const cool = index.pinSeed("cool", "UW L");

  it.each(["gruel", "duel", "crewel", "renewal"])(
    "accepts %j, whose final schwa most speakers drop",
    (submission) => {
      expect(isAccepted(index.adjudicate(cool, submission))).toBe(true);
    },
  );

  it("tiers `crewel` as a Bonus Word — the rule decides rhyme, not knownness", () => {
    expect(index.adjudicate(cool, "crewel").outcome).toBe("bonus");
  });

  it("still accepts `pool`, whose final vowel is stressed", () => {
    expect(index.adjudicate(cool, "pool").outcome).toBe("answer");
  });

  it("keeps the two-syllable reading of `gruel` alongside the one-syllable one", () => {
    expect(index.rhymeKeysOf("gruel")).toEqual(["UW AH L", "UW L"]);
  });

  it("puts every one of them in the `cool` Puzzle", () => {
    const puzzle = index.buildPuzzle(cool);
    const members = [...puzzle.answers, ...puzzle.bonusWords].map((e) => e.word);

    expect(members).toEqual(expect.arrayContaining(["gruel", "duel", "crewel", "renewal"]));
  });
});

describe("a full vowel still separates two words", () => {
  const index = makeTestIndex();

  it("does not turn `crayon` into `crane`", () => {
    // `AA0` is unstressed but not reduced. Dropping it would be a claim about
    // the ear that no General American listener would recognise.
    //
    // `crayon` is pinned explicitly because stress promotion (issue #73) gives
    // it a second Rhyme Key on `AA N` — "cray-ON", which is how the real
    // dictionary marks it — so it now reads as ambiguous.
    expect(index.adjudicate(index.pinSeed("crane"), "crayon")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
    expect(index.adjudicate(index.pinSeed("crayon", "EY AA N"), "crane")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });
});

describe("an unabsorbing vowel keeps its own syllable", () => {
  // Measured, not reasoned. `IY` came first: without that limit the rule reached
  // 99 words in the playable lexicon and got roughly half of them wrong, every
  // error behind `IY`. `ER` and `EY` joined it in #209, on a second measurement
  // taken over the words where the rule changes a rhyme verdict rather than
  // every word it rewrites. The vowels that still absorb end in an offglide
  // that swallows the schwa; these three do not, so the schwa stays audible.

  it("does not let `museum` rhyme with `dream`", () => {
    const data = target([["museum", [["M", "Y", "UW0", "Z", "IY1", "AH0", "M"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("museum")).toEqual([
      ["M", "Y", "UW0", "Z", "IY1", "AH0", "M"],
    ]);
  });

  it("does not let `librarian` rhyme with `green`", () => {
    const data = target([
      ["librarian", [["L", "AY0", "B", "R", "EH1", "R", "IY2", "AH0", "N"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("librarian")).not.toContainEqual([
      "L", "AY0", "B", "R", "EH1", "R", "IY2", "N",
    ]);
  });

  it("does not let `liberal` rhyme with `curl`", () => {
    const data = target([["liberal", [["L", "IH1", "B", "ER0", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("liberal")).toEqual([
      ["L", "IH1", "B", "ER0", "AH0", "L"],
    ]);
  });

  it("does not let `betrayal` rhyme with `pale`", () => {
    const data = target([["betrayal", [["B", "IH0", "T", "R", "EY1", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("betrayal")).toEqual([
      ["B", "IH0", "T", "R", "EY1", "AH0", "L"],
    ]);
  });

  it("does not let `serial` rhyme with `feel`", () => {
    const data = target([["serial", [["S", "IH1", "R", "IY0", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("serial")).toEqual([
      ["S", "IH1", "R", "IY0", "AH0", "L"],
    ]);
  });

  it("still absorbs the schwa after the offglide vowels", () => {
    // The limit is the unabsorbing set alone — it must not cost the rule its
    // target words, nor the uncontroversial cases behind `AW` and `AY`.
    const data = target([
      ["gruel", [["G", "R", "UW1", "AH0", "L"]]],
      ["towel", [["T", "AW1", "AH0", "L"]]],
      ["trial", [["T", "R", "AY1", "AH0", "L"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("gruel")).toContainEqual(["G", "R", "UW1", "L"]);
    expect(data.pronunciations.get("towel")).toContainEqual(["T", "AW1", "L"]);
    expect(data.pronunciations.get("trial")).toContainEqual(["T", "R", "AY1", "L"]);
  });

  it("still makes the consonant syllabic after a consonant", () => {
    // `IY` is checked only where it actually precedes the schwa; the textbook
    // syllabic-consonant case is untouched.
    const data = target([["ribbon", [["R", "IH1", "B", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ribbon")).toContainEqual(["R", "IH1", "B", "N"]);
  });
});

describe("a liquid before the schwa keeps its own syllable", () => {
  // A liquid is at least as sonorous as the sonorant that would carry the
  // syllable, so the schwa between them is the only thing separating two peaks.
  // Unmeasured, this class was the larger half of #209: it put `forum` in the
  // `storm` family, `baron` in `cairn`'s and `column` in `calm`'s.

  it("does not let `forum` rhyme with `storm`", () => {
    const data = target([["forum", [["F", "AO1", "R", "AH0", "M"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("forum")).toEqual([["F", "AO1", "R", "AH0", "M"]]);
  });

  it("does not let `baron` rhyme with `cairn`", () => {
    const data = target([["baron", [["B", "EH1", "R", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("baron")).toEqual([["B", "EH1", "R", "AH0", "N"]]);
  });

  it("does not let `column` rhyme with `calm`", () => {
    const data = target([["column", [["K", "AA1", "L", "AH0", "M"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("column")).toEqual([["K", "AA1", "L", "AH0", "M"]]);
  });

  it("still absorbs the schwa after a consonant that is not a liquid", () => {
    // The limit is about the liquid, not about the cluster it sits in: `spasm`
    // and `session` are the textbook case and must survive.
    const data = target([
      ["spasm", [["S", "P", "AE1", "Z", "AH0", "M"]]],
      ["session", [["S", "EH1", "SH", "AH0", "N"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("spasm")).toContainEqual(["S", "P", "AE1", "Z", "M"]);
    expect(data.pronunciations.get("session")).toContainEqual(["S", "EH1", "SH", "N"]);
  });
});

describe("after a vowel, only L absorbs the schwa", () => {
  // A consonant before the schwa stays in the Rhyme Key and keeps it
  // distinctive. A vowel leaves a two-phoneme key, and there the sonorant
  // decides: L genuinely absorbs the schwa, the nasals do not.

  it("does not let `ruin` rhyme with `moon`", () => {
    const data = target([["ruin", [["R", "UW1", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ruin")).toEqual([["R", "UW1", "AH0", "N"]]);
  });

  it("does not let `urine` rhyme with `burn`", () => {
    const data = target([["urine", [["Y", "ER1", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("urine")).toEqual([["Y", "ER1", "AH0", "N"]]);
  });

  it("does not let `jeroboam` rhyme with `home`", () => {
    const data = target([
      ["jeroboam", [["JH", "EH2", "R", "AH0", "B", "OW1", "AH0", "M"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("jeroboam")).toEqual([
      ["JH", "EH2", "R", "AH0", "B", "OW1", "AH0", "M"],
    ]);
  });

  it("does not let `lion` rhyme with `line`", () => {
    const data = target([["lion", [["L", "AY1", "AH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("lion")).toEqual([["L", "AY1", "AH0", "N"]]);
  });

  it("still absorbs the schwa into an L after a vowel", () => {
    const data = target([["denial", [["D", "IH0", "N", "AY1", "AH0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("denial")).toContainEqual([
      "D", "IH0", "N", "AY1", "L",
    ]);
  });

  it("still makes a nasal syllabic after a consonant", () => {
    // The nasal limit is about what precedes the schwa, not the nasal itself:
    // `button` and `rhythm` are the textbook case and must survive.
    const data = target([
      ["button", [["B", "AH1", "T", "AH0", "N"]]],
      ["rhythm", [["R", "IH1", "DH", "AH0", "M"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("button")).toContainEqual(["B", "AH1", "T", "N"]);
    expect(data.pronunciations.get("rhythm")).toContainEqual(["R", "IH1", "DH", "M"]);
  });
});
