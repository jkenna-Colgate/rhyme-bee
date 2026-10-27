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
 *
 * A row here failing is not a broken test. It is a normalisation that has
 * overreached, and the rule goes, not the row.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { rhymeKeyOf } from "../phonology.ts";
import type { SeedWord } from "../rhymeIndex.ts";

const index = makeTestIndex();

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
      for (const pinned of seedsOf(seed)) {
        expect(index.adjudicate(pinned, submission)).toMatchObject({
          outcome: "rejected",
          reason: "does-not-rhyme",
        });
      }
    });
  }
});
