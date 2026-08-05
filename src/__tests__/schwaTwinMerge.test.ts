/**
 * Schwa Twins at the index and curation seams (issue #110): `EH K SH AH N`
 * (`rejection`) and `EH K SH N` (its own generated variant, and the only
 * reading `subsection` has anywhere near this sound) are pinned as one
 * defect, the way `demotions.test.ts` pins the leaked-name defect — a test
 * that fails against today's curation and passes once Schwa Twins are merged.
 *
 * `subsection`'s reading is CMUdict's own, unmodified: normalisation (frozen,
 * untouched by this fix) composes stress promotion with the syllabic-consonant
 * rule to give it exactly the three Rhyme Keys the real index carries —
 * `AH B S EH K SH AH N`, `AH B S EH K SH N`, `EH K SH N` — verified against
 * the shipped `dist-data/` index artifact before writing this fixture. None of the
 * three is `EH K SH AH N`, which is the whole of the bug: on a Seed pinned
 * there, `subsection` had nothing to match.
 */

import { describe, expect, it } from "vitest";
import { buildSlice } from "../__fixtures__/build.ts";
import { curate } from "../curation.ts";
import type { Pronunciation } from "../phonology.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";
import { isAccepted } from "../verdict.ts";

function makeSubsectionIndex(): RhymeIndex {
  const p = (...phonemes: string[]): Pronunciation[] => [phonemes];
  const pronunciations = new Map<string, Pronunciation[]>([
    ["rejection", p("R", "IH0", "JH", "EH1", "K", "SH", "AH0", "N")],
    ["objection", p("AH0", "B", "JH", "EH1", "K", "SH", "AH0", "N")],
    // CMUdict's real, unmodified transcription of `subsection`.
    ["subsection", p("S", "AH1", "B", "S", "EH0", "K", "SH", "AH0", "N")],
  ]);
  return buildSlice(
    {
      pronunciations,
      words: ["rejection", "objection", "subsection"],
      prevalence: new Map([
        ["rejection", 2.0],
        ["objection", 2.0],
        ["subsection", 2.0],
      ]),
    },
    0,
  ).index;
}

describe("Schwa Twins collapse into one family (issue #110)", () => {
  it("reproduces the fixture shape: subsection never reaches EH K SH AH N on its own reading", () => {
    const index = makeSubsectionIndex();
    expect(index.rhymeKeysOf("subsection")).not.toContain("EH K SH AH N");
    expect(index.rhymeKeysOf("subsection")).toContain("EH K SH N");
  });

  it("treats EH K SH AH N and EH K SH N as one family, not two candidate Seeds", () => {
    const index = makeSubsectionIndex();
    const report = curate(index, { sizeBand: { min: 1, max: 10 } });
    const keys = report.families.map((f) => f.rhymeKey);

    expect(keys).toContain("EH K SH AH N");
    expect(keys).not.toContain("EH K SH N"); // absorbed into the schwa-ful key
  });

  it("the merged family's Answer count is the union, not just the schwa-ful side's own members", () => {
    const index = makeSubsectionIndex();
    const report = curate(index, { sizeBand: { min: 1, max: 10 } });
    const family = report.families.find((f) => f.rhymeKey === "EH K SH AH N");

    // Members: rejection, objection, subsection (3, deduplicated). One
    // represents the family and is excluded from its own Answer count,
    // leaving 2 — the schwa-ful side alone would leave only 1.
    expect(family?.answerCount).toBe(2);
  });

  it("subsection is accepted for a Seed pinned to the schwa-ful key (was wrongly rejected)", () => {
    const index = makeSubsectionIndex();
    const seed = index.pinSeed("rejection", "EH K SH AH N");

    expect(isAccepted(index.adjudicate(seed, "subsection"))).toBe(true);
  });

  it("subsection appears in the built Puzzle for that Seed", () => {
    const index = makeSubsectionIndex();
    const seed = index.pinSeed("rejection", "EH K SH AH N");
    const puzzle = index.buildPuzzle(seed);
    const members = [...puzzle.answers, ...puzzle.bonusWords].map((e) => e.word);

    expect(members).toContain("subsection");
  });
});

describe("adjudication is otherwise unchanged (guardrail)", () => {
  // The originating ticket asked for "session still accepts passion as a
  // rhyme" — but session (/ˈsɛʃən/, EH) and passion (/ˈpæʃən/, AE) do not
  // share a Rhyme Key in General American, and no normalisation rule changes
  // that (confirmed against the real index: `EH SH AH N`/`EH SH N` vs
  // `AE SH AH N`/`AE SH N`). Asserting they rhyme would assert something
  // false about English. Instead: session must still accept a genuine
  // same-family rhyme — `aggression`, which really does share session's own
  // Schwa Twin pair — and must still reject `passion`, proving the new twin
  // fallback in `#matchingPronunciation` does not open a cross-vowel false
  // accept.
  function makeSessionIndex(): RhymeIndex {
    const p = (...phonemes: string[]): Pronunciation[] => [phonemes];
    const pronunciations = new Map<string, Pronunciation[]>([
      ["session", p("S", "EH1", "SH", "AH0", "N")],
      ["aggression", p("AH0", "G", "R", "EH1", "SH", "AH0", "N")],
      ["passion", p("P", "AE1", "SH", "AH0", "N")],
    ]);
    return buildSlice(
      {
        pronunciations,
        words: ["session", "aggression", "passion"],
        prevalence: new Map([
          ["session", 2.0],
          ["aggression", 2.0],
          ["passion", 2.0],
        ]),
      },
      0,
    ).index;
  }

  it("session still accepts aggression, its real same-family rhyme", () => {
    const index = makeSessionIndex();
    const seed = index.pinSeed("session", "EH SH AH N");

    expect(isAccepted(index.adjudicate(seed, "aggression"))).toBe(true);
  });

  it("session still rejects passion — a different stressed vowel shares no Rhyme Key", () => {
    const index = makeSessionIndex();
    const seed = index.pinSeed("session", "EH SH AH N");

    expect(index.adjudicate(seed, "passion")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });
});
