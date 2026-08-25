/**
 * The join a pasted third-party rhyme list gets against the day (#188).
 *
 * Pure — text in, buckets out — so every case here is a literal input and a
 * literal expectation, with no browser, no network and no fixture server. That
 * is the shape `dayCandidates.test.ts`, `demote.test.ts` and `decline.test.ts`
 * established for the editor's browser-side modules, and this follows it.
 *
 * The tests assert on what the join returns and never on how it got there: the
 * parse, the dedupe and the set membership are the module's own business, and a
 * test that reached into one would be a second implementation of it.
 */

import { describe, expect, it } from "vitest";
import type { DayWord, ScheduledDayReadout } from "../../scripts/editorDay.ts";
import { joinPastedList } from "../src/editor/pastedList.ts";

const DATE = "2026-08-15";
const IDIOTIC = "AA T IH K";

/** `n` as lower-case letters, so a generated list holds no two of the same. */
function letters(n: number): string {
  return n
    .toString(26)
    .split("")
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 26)))
    .join("");
}

function word(spelling: string, knownness: number | null = 0.5): DayWord {
  return { word: spelling, length: spelling.length, knownness };
}

/**
 * A day with the two lists the join reads and the rest of the payload filled in
 * plausibly. Only `answers` and `bonusWords` are ever varied: nothing else on a
 * readout is a fact about what the Puzzle covers.
 */
function day(answers: string[], bonusWords: string[] = []): ScheduledDayReadout {
  const facts = { answerCount: answers.length, maxScore: 100, difficulty: 0.4 };
  return {
    outcome: "day",
    date: DATE,
    weekday: "Sat",
    week: 3,
    seed: "idiotic",
    seedRespelling: "id-ee-OT-ik",
    rhymeKey: IDIOTIC,
    facts,
    drift: {
      date: DATE,
      weekday: "Sat",
      seed: "idiotic",
      rhymeKey: IDIOTIC,
      recorded: { answerCount: facts.answerCount, difficulty: facts.difficulty },
      recomputed: facts,
      weekdayBand: { weekday: "Sat", min: 0, max: 1 },
      sizeBand: { min: 1, max: 500 },
      drifted: false,
      reasons: [],
    },
    answers: answers.map((spelling) => word(spelling)),
    bonusWords: bonusWords.map((spelling) => word(spelling)),
  };
}

describe("joinPastedList", () => {
  it("drops a pasted word the day already serves as an Answer, and counts it", () => {
    const joined = joinPastedList("chaotic\nnecrotic", day(["chaotic"]));

    expect(joined.covered).toBe(1);
    expect(joined.residue).toEqual(["necrotic"]);
  });

  it("drops a pasted word the day already serves as a Bonus Word", () => {
    const joined = joinPastedList("zymotic\nnecrotic", day(["chaotic"], ["zymotic"]));

    expect(joined.covered).toBe(1);
    expect(joined.residue).toEqual(["necrotic"]);
  });

  it("counts the covered words rather than listing them", () => {
    const joined = joinPastedList("chaotic\nhypnotic\nnecrotic", day(["chaotic", "hypnotic"]));

    expect(joined).toEqual({ pasted: 3, covered: 2, residue: ["necrotic"] });
  });

  it("keeps the residue in the order the pasted list gave it", () => {
    const joined = joinPastedList("necrotic\nbiotic\northotic", day(["chaotic"]));

    expect(joined.residue).toEqual(["necrotic", "biotic", "orthotic"]);
  });

  it("drops phrases, hyphenated entries and affix fragments silently", () => {
    const joined = joinPastedList(
      "necrotic\nhard hat\nsemi-chaotic\n-otic\notic-",
      day(["chaotic"]),
    );

    expect(joined).toEqual({ pasted: 1, covered: 0, residue: ["necrotic"] });
  });

  it("drops malformed entries silently", () => {
    const joined = joinPastedList("necrotic\nb1otic\nchaotic¹\nx.y\n'", day([]));

    expect(joined).toEqual({ pasted: 1, covered: 0, residue: ["necrotic"] });
  });

  it("absorbs surrounding whitespace, blank lines, casing and duplicates", () => {
    const joined = joinPastedList(
      "  Necrotic \n\n\nBIOTIC\n necrotic\nnecrotic  \n",
      day(["chaotic"]),
    );

    expect(joined).toEqual({ pasted: 2, covered: 0, residue: ["necrotic", "biotic"] });
  });

  it("reads a comma-separated paste as entries, not as one phrase", () => {
    const joined = joinPastedList("chaotic, necrotic, hard hat", day(["chaotic"]));

    expect(joined).toEqual({ pasted: 2, covered: 1, residue: ["necrotic"] });
  });

  it("returns empty buckets for an empty paste rather than failing", () => {
    expect(joinPastedList("", day(["chaotic"]))).toEqual({ pasted: 0, covered: 0, residue: [] });
    expect(joinPastedList("   \n\n", day(["chaotic"]))).toEqual({
      pasted: 0,
      covered: 0,
      residue: [],
    });
  });

  it("accepts a paste of any size, with no cap in the tool", () => {
    // Five thousand *distinct* spellings, so nothing here is absorbed by the
    // dedupe and the count can only be shortened by a cap. There is none.
    const entries = Array.from({ length: 5000 }, (_, i) => `word${letters(i)}`);
    const joined = joinPastedList(entries.join("\n"), day(["chaotic"]));

    expect(joined.pasted).toBe(5000);
    expect(joined.residue).toHaveLength(5000);
  });

  it("drops a space-separated paste entire, rather than reading it as words", () => {
    // The cost of separating on newlines and commas but never on spaces, which
    // is what keeps `hard hat` detectable as a phrase. The panel is what tells
    // the editor this happened; the join just reports nothing found.
    const joined = joinPastedList("chaotic necrotic biotic", day(["chaotic"]));

    expect(joined).toEqual({ pasted: 0, covered: 0, residue: [] });
  });

  it("joins to nothing when the readout is not a day", () => {
    const nothing = { pasted: 0, covered: 0, residue: [] };

    expect(joinPastedList("necrotic\nbiotic", null)).toEqual(nothing);
    expect(
      joinPastedList("necrotic\nbiotic", {
        outcome: "not-scheduled",
        date: DATE,
        firstDate: "2026-08-01",
        lastDate: "2026-08-14",
      }),
    ).toEqual(nothing);
  });
});
