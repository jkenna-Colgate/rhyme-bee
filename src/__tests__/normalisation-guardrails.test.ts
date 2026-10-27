/**
 * The guardrail table: the contrasts normalisation is never allowed to erase.
 *
 * This is the enforcement mechanism for ADR-0010's admissibility test — *a
 * normalisation is admissible only if the contrast it erases is unavailable to a
 * General American listener, and only if the guardrail set survives intact*.
 * Every rule added to `src/normalise.ts` must pass this table unchanged, so a
 * future normalisation cannot quietly erode the sound rule into spelling-matching.
 *
 * Two groups, each guarding a different claim:
 *
 *   - the `-ate` group guards ADR-0001. A full vowel versus an unstressed schwa
 *     is a contrast everybody hears; it is the case the Rhyme rule was built on
 *     and the lesson the Tutorial teaches. Nobody has ever complained about it.
 *   - the pre-rhotic group guards the cot–caught merger's one exclusion. Most
 *     `AO` tokens in the playable lexicon sit before `R`, so merging them too
 *     would roughly double the `far` family — ADR-0010 carries the measurement.
 *   - the glide-before-r group guards the limits of the rule that reads "er" and
 *     plain `r` as each other after "eye", "ow" or "oy" (ADR-0011, amendment of
 *     2026-10-07): it reaches no other vowel, and no `r` that is not after one.
 *   - the t-and-d group guards the places the rule reading t and d as one sound
 *     before a weak vowel (ADR-0011, amendment of 2026-10-16) leaves out: the end
 *     of a word, before a stressed vowel, after "eye", before a syllabic n.
 *   - the vowel-before-r group guards the contrasts next to the rule writing a
 *     stressed vowel before `r` one way (ADR-0011, amendment of 2026-10-26):
 *     "ih" + r, "eh" + r, "er", "uu" + r and "ah" + r stay five sounds.
 *
 * A row here failing is not a broken test. It is a normalisation that has
 * overreached, and the rule goes, not the row.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { rhymeKeyOf } from "../phonology.ts";
import type { SeedWord } from "../rhymeIndex.ts";

// The t-and-d rows' words (#262) and the vowel-before-r rows' (#263), as the
// source dictionary writes them, with `eight`, `hair` and `fur` from the fixture.
// They are given here rather than in the shared fixture, where `seed` would join
// `read`'s one-word family that the curation suite counts on.
const index = makeTestIndex({
  pronunciations: [
    ["seat", [["S", "IY1", "T"]]],
    ["seed", [["S", "IY1", "D"]]],
    ["aid", [["EY1", "D"]]],
    ["attack", [["AH0", "T", "AE1", "K"]]],
    ["adapt", [["AH0", "D", "AE1", "P", "T"]]],
    ["writer", [["R", "AY1", "T", "ER0"]]],
    ["rider", [["R", "AY1", "D", "ER0"]]],
    ["button", [["B", "AH1", "T", "AH0", "N"]]],
    ["sudden", [["S", "AH1", "D", "AH0", "N"]]],
    ["here", [["HH", "IY1", "R"]]],
    ["fear", [["F", "IH1", "R"]]],
    ["fair", [["F", "EH1", "R"]]],
    ["poor", [["P", "UW1", "R"]]],
    ["purr", [["P", "ER1"]]],
    ["tour", [["T", "UH1", "R"]]],
    ["tar", [["T", "AA1", "R"]]],
  ],
  words: [
    "seat", "seed", "aid", "attack", "adapt", "writer", "rider", "button", "sudden",
    "here", "fear", "fair", "poor", "purr", "tour", "tar",
  ],
  prevalence: [
    ["seat", 2.5], ["seed", 2.5], ["aid", 2.5], ["attack", 2.5], ["adapt", 2.3],
    ["writer", 2.5], ["rider", 2.4], ["button", 2.5], ["sudden", 2.5],
    ["here", 2.5], ["fear", 2.5], ["fair", 2.5], ["poor", 2.5], ["purr", 2.1],
    ["tour", 2.5], ["tar", 2.3],
  ],
});

interface Guardrail {
  seed: string;
  submission: string;
  claim: string;
}

const guardrails: Guardrail[] = [
  // ADR-0001: an unstressed schwa is not the stressed EY these words are spelled
  // to suggest. "Say both aloud and they rhyme" fails for every one of them.
  { seed: "ate", submission: "chocolate", claim: "final syllable is an unstressed schwa" },
  { seed: "ate", submission: "private", claim: "final syllable is an unstressed schwa" },
  { seed: "ate", submission: "climate", claim: "final syllable is an unstressed schwa" },
  { seed: "ate", submission: "senate", claim: "final syllable is an unstressed schwa" },
  { seed: "ate", submission: "accurate", claim: "final syllable is an unstressed schwa" },
  { seed: "ate", submission: "commensurate", claim: "final syllable is an unstressed schwa" },
  // ADR-0010: the low-back merge stops at R. These pairs stay audibly distinct
  // to a merged speaker, so erasing them would fail the admissibility test.
  { seed: "far", submission: "for", claim: "pre-rhotic AO is not merged" },
  { seed: "barn", submission: "born", claim: "pre-rhotic AO is not merged" },
  { seed: "card", submission: "cord", claim: "pre-rhotic AO is not merged" },
  // ADR-0011, amendment of 2026-10-07: "er" and `r` are one sound only after
  // "eye", "ow" or "oy". The vowel before them still decides the Rhyme.
  { seed: "fire", submission: "far", claim: "the glide is not the vowel of far" },
  { seed: "fire", submission: "fur", claim: "the glide is not the vowel of fur" },
  { seed: "player", submission: "hair", claim: "er after long a is not plain r" },
  { seed: "lower", submission: "lore", claim: "er after long o is not plain r" },
  // ADR-0011, amendment of 2026-10-16: t and d are one sound only where General
  // American taps them. At the end of a word, before a stressed vowel, after
  // "eye" and before a syllabic n they are heard apart.
  { seed: "seat", submission: "seed", claim: "a final t is not a final d" },
  { seed: "eight", submission: "aid", claim: "a final t is not a final d" },
  { seed: "attack", submission: "adapt", claim: "t before a stressed vowel is not tapped" },
  { seed: "writer", submission: "rider", claim: "the vowel before t and d differs after eye" },
  { seed: "button", submission: "sudden", claim: "t before a syllabic n is a glottal stop" },
  // ADR-0011, amendment of 2026-10-26: a stressed vowel before r is written one
  // way, and the vowels next to the merged ones are still heard apart.
  { seed: "here", submission: "hair", claim: "ih before r is not eh before r" },
  { seed: "fear", submission: "fair", claim: "ih before r is not eh before r" },
  { seed: "fair", submission: "fur", claim: "eh before r is not er" },
  { seed: "poor", submission: "purr", claim: "uu before r is not er" },
  { seed: "tour", submission: "tar", claim: "uu before r is not ah before r" },
];

/**
 * The word pinned on every Rhyme Key a reading the dictionary wrote gives it, so
 * a word written two ways (`fire`) is held to the row on both.
 */
function seedsOf(word: string): SeedWord[] {
  const keys = new Set(
    index
      .readingsOf(word)
      .filter(({ generated }) => !generated)
      .map(({ pronunciation }) => rhymeKeyOf(pronunciation)),
  );
  return [...keys].filter((key) => key !== null).map((key) => index.pinSeed(word, key));
}

describe("normalisation guardrails", () => {
  // Each pair is asserted both ways round, as its own `it`, so a regression
  // names the row that broke rather than the block it sits in.
  const rows = guardrails.flatMap(({ seed, submission, claim }) => [
    { seed, submission, claim },
    { seed: submission, submission: seed, claim },
  ]);

  for (const { seed, submission, claim } of rows) {
    it(`${seed} + ${submission} -> does-not-rhyme (${claim})`, () => {
      const seeds = seedsOf(seed);
      expect(seeds, `${seed} pins on no Rhyme Key, so the row would pass vacuously`).not.toEqual([]);
      for (const pinned of seeds) {
        expect(index.adjudicate(pinned, submission)).toMatchObject({
          outcome: "rejected",
          reason: "does-not-rhyme",
        });
      }
    });
  }
});
