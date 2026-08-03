/**
 * Slice: the invariant curation is built on. Curation tallies each Rhyme Key's
 * family straight from its grouped words rather than building a Puzzle per key —
 * `buildPuzzle` re-scans every wordhood word on every call, so doing it per key
 * is O(keys × words). That shortcut is only sound while the two agree on
 * membership, tier judgement and Seed Word exclusion, and until now that
 * agreement was a comment in `curation.ts` plus two test suites that never met.
 *
 * This walks every Rhyme Key the fixture produces — not a chosen one — and
 * cross-checks. Answers and Bonus Words are compared separately, so a word
 * crossing the tier line is caught rather than cancelling out in a total.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { makeShortPluralIndex } from "../__fixtures__/shortPlurals.ts";
import { curate } from "../curation.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";

/**
 * Every family, against the Puzzle built from its own representative. The band
 * is opened wide on purpose: this is about `families`, which holds every key,
 * not about which of them are shippable.
 */
function crossCheck(index: RhymeIndex, label: string) {
  const { families } = curate(index, { sizeBand: { min: 0, max: Infinity } });

  it(`${label}: has families to check`, () => {
    expect(families.length).toBeGreaterThan(0);
  });

  it(`${label}: agrees with buildPuzzle on every Rhyme Key`, () => {
    const divergent: string[] = [];
    for (const family of families) {
      const puzzle = index.buildPuzzle({
        word: family.representative,
        rhymeKey: family.rhymeKey,
      });
      if (
        puzzle.answers.length !== family.answerCount ||
        puzzle.bonusWords.length !== family.bonusCount
      ) {
        divergent.push(
          `${family.rhymeKey} (${family.representative}): ` +
            `curation ${family.answerCount}a/${family.bonusCount}b, ` +
            `puzzle ${puzzle.answers.length}a/${puzzle.bonusWords.length}b`,
        );
      }
    }
    expect(divergent).toEqual([]);
  });

  it(`${label}: excludes the Seed Word from its own Puzzle`, () => {
    const present: string[] = [];
    for (const family of families) {
      const puzzle = index.buildPuzzle({
        word: family.representative,
        rhymeKey: family.rhymeKey,
      });
      const members = [
        ...puzzle.answers.map((a) => a.word),
        ...puzzle.bonusWords.map((b) => b.word),
      ];
      if (members.includes(family.representative)) present.push(family.rhymeKey);
    }
    expect(present).toEqual([]);
  });
}

describe("curation's family tally agrees with buildPuzzle", () => {
  crossCheck(makeTestIndex(), "main fixture");
  // The short-plural slice exercises the sound-gated lemma rule, which moves
  // words across the tier line — exactly the divergence a total would hide.
  crossCheck(makeShortPluralIndex(), "short plurals");
});

describe("curation reaches every family in one traversal", () => {
  // The performance property the duplication existed to protect. Sharing the
  // definition is only worth it if curation does not pay `buildPuzzle`'s
  // whole-word-list scan once per Rhyme Key — which on the real index is 133k
  // words times thousands of keys.
  it("scans the word list once, however many Rhyme Keys there are", () => {
    const index = makeTestIndex();
    let scans = 0;
    const realEntries = index.wordhoodEntries.bind(index);
    index.wordhoodEntries = function* countingEntries() {
      scans++;
      yield* realEntries();
    };

    const report = curate(index, { sizeBand: { min: 0, max: Infinity } });

    expect(report.families.length).toBeGreaterThan(1);
    expect(scans).toBe(1);
  });
});
