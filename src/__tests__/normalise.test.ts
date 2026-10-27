/**
 * The normalisation stage is the accent specification applied to the stored
 * readings at build time (ADR-0010). It runs after the committed supplement and
 * before any Rhyme Key is computed, so a hand-authored reading is an input to it
 * rather than an exemption from it.
 *
 * These tests assert a reading or a verdict, never a rule's internals — which
 * rules exist is implementation detail, but what a player may submit is not.
 */

import { describe, expect, it } from "vitest";
import { applyNormalisation } from "../normalise.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { rhymeKeyOf, type Pronunciation } from "../phonology.ts";
import { isAccepted } from "../verdict.ts";

function target(entries: [string, Pronunciation[]][] = []) {
  return { pronunciations: new Map(entries) };
}

describe("applyNormalisation", () => {
  it("merges AO into AA, keeping the stress digit", () => {
    const data = target([["talked", [["T", "AO1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("talked")).toEqual([["T", "AA1", "K", "T"]]);
  });

  it("replaces the reading rather than appending a variant", () => {
    // Load-bearing: the respelling layer renders AA and AO differently, so only
    // a replacement makes an accepted rhyme read as a rhyme on screen. It also
    // keeps `talked` a one-Rhyme-Key word instead of an accidental homograph.
    const data = target([["balked", [["B", "AO1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("balked")).toHaveLength(1);
  });

  it("leaves AO alone immediately before R", () => {
    const data = target([["for", [["F", "AO1", "R"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("for")).toEqual([["F", "AO1", "R"]]);
  });

  it("merges AO before L — `ball` takes the `doll` vowel", () => {
    const data = target([["ball", [["B", "AO1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("ball")).toEqual([["B", "AA1", "L"]]);
  });

  it("decides each AO on its own position within one reading", () => {
    // `waterborne` has both: AO1 before T merges, AO2 before R does not.
    const data = target([
      ["waterborne", [["W", "AO1", "T", "ER0", "B", "AO2", "R", "N"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("waterborne")).toEqual([
      ["W", "AA1", "T", "ER0", "B", "AO2", "R", "N"],
    ]);
  });

  it("collapses readings that the merge makes identical", () => {
    // CMUdict lists some words both ways; after the merge they are one reading,
    // and a duplicate would otherwise sit in the map forever.
    const data = target([["dog", [["D", "AO1", "G"], ["D", "AA1", "G"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("dog")).toEqual([["D", "AA1", "G"]]);
  });

  it("leaves a reading with no AO untouched", () => {
    const data = target([["docked", [["D", "AA1", "K", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("docked")).toEqual([["D", "AA1", "K", "T"]]);
  });
});

describe("a normalised index adjudicates", () => {
  const index = makeTestIndex();
  const docked = index.pinSeed("docked");

  it.each(["talked", "walked", "balked", "stalked", "hawked"])(
    "accepts %j for the Seed Word `docked`",
    (submission) => {
      expect(index.adjudicate(docked, submission).outcome).toBe("answer");
    },
  );

  it("pins `docked` to the Rhyme Key AA K T", () => {
    expect(docked.rhymeKey).toBe("AA K T");
  });

  it("gives `talked` one Rhyme Key, not two — the merge is not a variant", () => {
    expect(index.rhymeKeysOf("talked")).toEqual(["AA K T"]);
    expect(index.isAmbiguous("talked")).toBe(false);
  });

  it("rhymes `ball` with `doll` — pre-lateral position is merged", () => {
    expect(index.adjudicate(index.pinSeed("doll"), "ball").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("ball"), "doll").outcome).toBe("answer");
  });
});

describe("a normalised respelling", () => {
  const index = makeTestIndex();
  const docked = index.pinSeed("docked");

  it("shows the merged vowel, so an acceptance reads as a rhyme", () => {
    // Story 8: the screen must not show two different vowels while calling them
    // a rhyme. `talked` is "TAH-kt" against a Seed respelled "DAH-kt".
    const verdict = index.adjudicate(docked, "talked");
    expect(verdict).toMatchObject({ outcome: "answer", respelling: "TAH-kt" });
    expect(index.buildPuzzle(docked).seedRespelling).toBe("DAH-kt");
  });

  it("shares the rhyming tail of the Seed Word's respelling", () => {
    // Story 7, stated without hard-coding a spelling: whatever the Seed reads
    // as after its onset consonant, every accepted rhyme's respelling contains.
    const tail = index.buildPuzzle(docked).seedRespelling.slice(1).toLowerCase();

    for (const submission of ["talked", "walked", "balked", "stalked", "hawked"]) {
      const verdict = index.adjudicate(docked, submission);
      expect(isAccepted(verdict)).toBe(true);
      if (isAccepted(verdict)) {
        expect(verdict.respelling.toLowerCase()).toContain(tail);
      }
    }
  });
});

describe("normalisation runs after the committed supplement", () => {
  it("applies the accent specification to a hand-authored reading too", () => {
    // A supplement entry asserts a *reading*; normalisation asserts the accent.
    // `chalked` arrives with AO from the human override and is still merged, so
    // the override is an input to the accent spec, not an exemption from it.
    const index = makeTestIndex({ supplement: "chalked  CH AO1 K T" });

    expect(index.adjudicate(index.pinSeed("docked"), "chalked").outcome).toBe("bonus");
  });
});

describe("weak ih and weak uh after the stressed vowel are one sound (#260)", () => {
  // Readings exactly as the source dictionary writes them, which spells one
  // ending both ways (ADR-0011, amendment of 2026-10-07).
  const index = makeTestIndex({
    pronunciations: [
      ["facility", [["F", "AH0", "S", "IH1", "L", "IH0", "T", "IY0"]]],
      ["utility", [["Y", "UW0", "T", "IH1", "L", "AH0", "T", "IY0"]]],
      ["abated", [["AH0", "B", "EY1", "T", "IH0", "D"]]],
      ["annotated", [
        ["AE2", "N", "AH0", "T", "EY1", "T", "IH0", "D"],
        ["AE1", "N", "AH0", "T", "EY2", "T", "AH0", "D"],
      ]],
      ["created", [["K", "R", "IY0", "EY1", "T", "AH0", "D"]]],
      ["collection", [["K", "AH0", "L", "EH1", "K", "SH", "AH0", "N"]]],
      ["direction", [
        ["D", "ER0", "EH1", "K", "SH", "AH0", "N"],
        ["D", "IY0", "R", "EH1", "K", "SH", "IH0", "N"],
        ["D", "AY0", "R", "EH1", "K", "SH", "IH0", "N"],
        ["D", "IH0", "R", "EH1", "K", "SH", "IH0", "N"],
      ]],
    ],
    words: ["facility", "utility", "abated", "annotated", "created", "collection", "direction"],
    prevalence: [
      ["facility", 2.5], ["utility", 2.5], ["abated", 1.5], ["annotated", 1.7],
      ["created", 2.5], ["collection", 2.4], ["direction", 2.3],
    ],
  });

  it("rhymes `utility` with `facility`, and the reverse", () => {
    expect(index.adjudicate(index.pinSeed("facility"), "utility").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("utility"), "facility").outcome).toBe("answer");
  });

  it("rhymes `abated` with `created`, the `annotated` family written with weak uh", () => {
    expect(index.adjudicate(index.pinSeed("abated"), "created").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("created"), "abated").outcome).toBe("answer");
  });

  it("hears `annotated` one way, so it pins with no key given", () => {
    // Its two readings were two Rhyme Keys apart only on the weak vowel written.
    // The t is tapped as well (#262).
    expect(index.rhymeKeysOf("annotated")).toEqual(["EY D AH D"]);
    expect(index.adjudicate(index.pinSeed("annotated"), "abated").outcome).toBe("answer");
  });

  it("files every `direction` reading under the `collection` key", () => {
    expect(index.rhymeKeysOf("direction")).not.toContain("EH K SH IH N");
    const seed = index.pinSeed("direction", "EH K SH AH N");
    expect(index.adjudicate(seed, "collection").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("collection", "EH K SH AH N"), "direction").outcome)
      .toBe("answer");
  });

  it("leaves a weak vowel before the stressed one as written, since no Rhyme reaches it", () => {
    const data = target([["direction", [["D", "IH0", "R", "EH1", "K", "SH", "IH0", "N"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("direction")).toEqual([
      ["D", "IH0", "R", "EH1", "K", "SH", "AH0", "N"],
    ]);
  });
});

describe("the weak vowel a Weak Rhyme reads is the one the dictionary wrote (#260)", () => {
  // ADR-0020 as narrowed on #232: the Weak Rhyme test sees the written weak
  // vowel, so `aspirin` for `win` is accepted and `muffin` is not. The merge
  // above must leave that reading reachable, beside the one a Rhyme reads.
  const index = makeTestIndex({
    pronunciations: [
      ["aspirin", [["AE1", "S", "P", "R", "IH0", "N"]]],
      ["muffin", [["M", "AH1", "F", "AH0", "N"]]],
      ["magic", [["M", "AE1", "JH", "IH0", "K"]]],
      ["trick", [["T", "R", "IH1", "K"]]],
    ],
    words: ["aspirin", "muffin", "magic", "trick"],
    prevalence: [["aspirin", 2.3], ["muffin", 2.4], ["magic", 2.5], ["trick", 2.5]],
  });

  it("keeps the written ih of `aspirin` and `magic`, where a Rhyme reads uh", () => {
    expect(index.rhymeKeysOf("magic")).toEqual(["AE JH AH K"]);
    expect(index.writtenReadingsOf("magic")).toEqual([["M", "AE1", "JH", "IH0", "K"]]);
    expect(index.writtenReadingsOf("aspirin")).toEqual([["AE1", "S", "P", "R", "IH0", "N"]]);
  });

  it("gives a word the merge never touched its ordinary readings", () => {
    expect(index.writtenReadingsOf("trick")).toEqual([["T", "R", "IH1", "K"]]);
    expect(index.writtenReadingsOf("muffin")).toEqual(index.readingsOf("muffin").map((r) => r.pronunciation));
  });
});

describe("after eye, ow or oy, er and plain r read as each other (#261)", () => {
  // Readings exactly as the source dictionary writes them: `fire`, `hour` and
  // `flour` both ways, `higher` and `power` with "er" only, and `expire` and
  // `dower` with plain r only (ADR-0011, amendment of 2026-10-07).
  const index = makeTestIndex({
    pronunciations: [
      ["fire", [["F", "AY1", "ER0"], ["F", "AY1", "R"]]],
      ["higher", [["HH", "AY1", "ER0"]]],
      ["expire", [["IH0", "K", "S", "P", "AY1", "R"]]],
      ["hour", [["AW1", "ER0"], ["AW1", "R"]]],
      ["flour", [["F", "L", "AW1", "ER0"], ["F", "L", "AW1", "R"]]],
      ["power", [["P", "AW1", "ER0"]]],
      ["dower", [["D", "AW1", "R"]]],
      ["virus", [["V", "AY1", "R", "AH0", "S"]]],
      ["vampire", [["V", "AE1", "M", "P", "AY0", "R"]]],
    ],
    words: ["fire", "higher", "expire", "hour", "flour", "power", "dower", "virus", "vampire"],
    prevalence: [
      ["fire", 2.5], ["higher", 2.5], ["expire", 2.3], ["hour", 2.5],
      ["flour", 2.4], ["power", 2.5], ["dower", 1.2], ["virus", 2.5], ["vampire", 2.3],
    ],
  });

  it("rhymes `higher` with `fire`, in both orders", () => {
    expect(index.adjudicate(index.pinSeed("higher", "AY ER"), "fire").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("fire", "AY ER"), "higher").outcome).toBe("answer");
  });

  it("rhymes `expire`, written with plain r only, with `higher`, written with er only", () => {
    expect(index.adjudicate(index.pinSeed("expire", "AY R"), "higher").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("higher", "AY ER"), "expire").outcome).toBe("answer");
  });

  it("rhymes `vampire`, whose unstressed eye a Rhyme hears stressed, with `higher`", () => {
    expect(index.adjudicate(index.pinSeed("higher", "AY ER"), "vampire").outcome).toBe("answer");
  });

  it("rhymes `hour`, `flour` and `power` with one another, and `dower` with all three", () => {
    for (const seed of ["hour", "flour", "power"]) {
      const pinned = index.pinSeed(seed, "AW ER");
      for (const word of ["hour", "flour", "power", "dower"].filter((w) => w !== seed)) {
        expect(index.adjudicate(pinned, word).outcome, `${word} for ${seed}`).toBe("answer");
      }
    }
    expect(index.adjudicate(index.pinSeed("dower", "AW R"), "power").outcome).toBe("answer");
  });

  it("pins `power` only on the reading the dictionary wrote", () => {
    expect(() => index.pinSeed("power", "AW R")).toThrow(/generated variant/);
  });

  it("leaves an r that opens the next syllable alone", () => {
    expect(index.rhymeKeysOf("virus")).toEqual(["AY R AH S"]);
  });
});

describe("t and d after a vowel or r, before a weak vowel, are one sound (#262)", () => {
  // Readings exactly as the source dictionary writes them (ADR-0011, amendment
  // of 2026-10-16). General American says the t and the d as the same tap.
  const index = makeTestIndex({
    pronunciations: [
      ["latter", [["L", "AE1", "T", "ER0"]]],
      ["ladder", [["L", "AE1", "D", "ER0"]]],
      ["metal", [["M", "EH1", "T", "AH0", "L"]]],
      ["medal", [["M", "EH1", "D", "AH0", "L"]]],
      ["computer", [["K", "AH0", "M", "P", "Y", "UW1", "T", "ER0"]]],
      ["ruder", [["R", "UW1", "D", "ER0"]]],
      ["quarter", [["K", "W", "AO1", "R", "T", "ER0"]]],
      ["disorder", [["D", "IH0", "S", "AO1", "R", "D", "ER0"]]],
      ["charity", [["CH", "EH1", "R", "IH0", "T", "IY0"]]],
      ["parody", [["P", "EH1", "R", "AH0", "D", "IY0"]]],
      ["shouted", [["SH", "AW1", "T", "IH0", "D"]]],
      ["crowded", [["K", "R", "AW1", "D", "AH0", "D"], ["K", "R", "AW1", "D", "IH0", "D"]]],
      ["fighting", [["F", "AY1", "T", "IH0", "NG"]]],
      ["deciding", [["D", "IH2", "S", "AY1", "D", "IH0", "NG"]]],
      ["written", [["R", "IH1", "T", "AH0", "N"]]],
      ["hidden", [["HH", "IH1", "D", "AH0", "N"]]],
      ["curtains", [["K", "ER1", "T", "AH0", "N", "Z"]]],
      ["burdens", [["B", "ER1", "D", "AH0", "N", "Z"]]],
      ["water", [["W", "AO1", "T", "ER0"]]],
    ],
    words: [
      "latter", "ladder", "metal", "medal", "computer", "ruder", "quarter", "disorder",
      "charity", "parody", "shouted", "crowded", "fighting", "deciding", "written",
      "hidden", "curtains", "burdens", "water",
    ],
    prevalence: [
      ["latter", 2.2], ["ladder", 2.5], ["metal", 2.5], ["medal", 2.4], ["computer", 2.5],
      ["ruder", 2.0], ["quarter", 2.5], ["disorder", 2.3], ["charity", 2.5], ["parody", 2.2],
      ["shouted", 2.4], ["crowded", 2.4], ["fighting", 2.5], ["deciding", 2.4],
      ["written", 2.5], ["hidden", 2.5], ["curtains", 2.4], ["burdens", 2.2], ["water", 2.5],
    ],
  });

  /**
   * The word pinned on the Rhyme Key of the reading the dictionary wrote. A word
   * ending in a syllabic n or l also holds the syllabic rule's reading, so it
   * cannot pin with no key given.
   */
  const pin = (word: string) =>
    index.pinSeed(word, rhymeKeyOf(index.readingsOf(word)[0]!.pronunciation)!);

  it("rhymes `latter` with `ladder`, in both orders", () => {
    expect(index.adjudicate(pin("latter"), "ladder").outcome).toBe("answer");
    expect(index.adjudicate(pin("ladder"), "latter").outcome).toBe("answer");
  });

  it.each([
    ["metal", "medal"],
    ["computer", "ruder"],
    ["quarter", "disorder"],
    ["charity", "parody"],
    ["shouted", "crowded"],
  ])("rhymes %j with %j, in both orders", (a, b) => {
    expect(index.adjudicate(pin(a), b).outcome).toBe("answer");
    expect(index.adjudicate(pin(b), a).outcome).toBe("answer");
  });

  it.each([
    ["fighting", "deciding"],
    ["written", "hidden"],
    ["curtains", "burdens"],
  ])("keeps %j apart from %j, where the t is not a tap", (a, b) => {
    expect(index.adjudicate(pin(a), b)).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });
    expect(index.adjudicate(pin(b), a)).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });
  });

  it("respells the tap as d", () => {
    // An unstressed "er" respells as "ur": the ticket's "WAH-der" is this.
    expect(index.buildPuzzle(pin("water")).seedRespelling).toBe("WAH-dur");
  });

  it("hears `metal` one way, though its syllabic reading keeps its t", () => {
    expect(index.rhymeKeysOf("metal")).toEqual(["EH D AH L", "EH T L"]);
    expect(() => index.pinSeed("metal", "EH T L")).toThrow(/generated variant/);
  });
});

describe("a stressed vowel before r is written one way (#263)", () => {
  // Readings exactly as the source dictionary writes them (ADR-0011, amendment
  // of 2026-10-26). General American has no "ee" + r against "ih" + r, no "oo"
  // + r against "uu" + r, no "ay" + r against "eh" + r, and before r and a
  // vowel no "a" against "eh".
  const index = makeTestIndex({
    pronunciations: [
      ["here", [["HH", "IY1", "R"]]],
      ["near", [["N", "IH1", "R"]]],
      ["hearing", [["HH", "IY1", "R", "IH0", "NG"]]],
      ["cheering", [["CH", "IH1", "R", "IH0", "NG"]]],
      ["engineered", [["EH2", "N", "JH", "AH0", "N", "IY1", "R", "D"]]],
      ["beard", [["B", "IH1", "R", "D"]]],
      ["graybeard", [["G", "R", "EY1", "B", "IY0", "R", "D"]]],
      ["poor", [["P", "UW1", "R"]]],
      ["tour", [["T", "UH1", "R"]]],
      ["menswear", [["M", "EH1", "N", "Z", "W", "EY2", "R"]]],
      ["air", [["EH1", "R"]]],
      ["barbaric", [["B", "AA0", "R", "B", "AE1", "R", "IH0", "K"]]],
      ["generic", [["JH", "AH0", "N", "EH1", "R", "IH0", "K"]]],
    ],
    words: [
      "here", "near", "hearing", "cheering", "engineered", "beard", "graybeard",
      "poor", "tour", "menswear", "air", "barbaric", "generic",
    ],
    prevalence: [
      ["here", 2.5], ["near", 2.5], ["hearing", 2.5], ["cheering", 2.4], ["engineered", 2.3],
      ["beard", 2.5], ["graybeard", 1.9], ["poor", 2.5], ["tour", 2.5], ["menswear", 2.2],
      ["air", 2.5], ["barbaric", 2.3], ["generic", 2.4],
    ],
  });

  const pin = (word: string) =>
    index.pinSeed(word, rhymeKeyOf(index.readingsOf(word)[0]!.pronunciation)!);

  it.each([
    ["here", "near"],
    ["hearing", "cheering"],
    ["engineered", "beard"],
    ["poor", "tour"],
    ["menswear", "air"],
    ["barbaric", "generic"],
  ])("rhymes %j with %j, in both orders", (a, b) => {
    expect(index.adjudicate(pin(a), b).outcome).toBe("answer");
    expect(index.adjudicate(pin(b), a).outcome).toBe("answer");
  });

  it("writes the stressed vowel the merged way in every position, not only the Rhyme Key's", () => {
    const t = target([["hearsay", [["HH", "IY1", "R", "S", "EY2"]]]]);
    applyNormalisation(t);
    expect(t.pronunciations.get("hearsay")).toEqual([["HH", "IH1", "R", "S", "EY2"]]);
  });

  it("leaves an unstressed vowel before r as written", () => {
    const t = target([["copyreader", [["K", "AA1", "P", "IY0", "R", "IY2", "D", "ER0"]]]]);
    applyNormalisation(t);
    expect(t.pronunciations.get("copyreader")![0]!.slice(0, 5)).toEqual(["K", "AA1", "P", "IY0", "R"]);
  });

  it("leaves \"a\" before r and a consonant as written, so `car` and `care` stay apart", () => {
    const t = target([["nares", [["N", "AE1", "R", "Z"]]]]);
    applyNormalisation(t);
    expect(t.pronunciations.get("nares")).toEqual([["N", "AE1", "R", "Z"]]);
  });

  it("rhymes `graybeard`, whose unstressed vowel a Rhyme hears stressed, with `beard`", () => {
    expect(index.adjudicate(pin("beard"), "graybeard").outcome).toBe("answer");
    expect(() => index.pinSeed("graybeard", "IH R D")).toThrow(/generated variant/);
  });
});
