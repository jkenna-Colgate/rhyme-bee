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
 *
 * A row here failing is not a broken test. It is a normalisation that has
 * overreached, and the rule goes, not the row.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";

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
];

describe("normalisation guardrails", () => {
  // Each pair is asserted both ways round, as its own `it`, so a regression
  // names the row that broke rather than the block it sits in.
  const rows = guardrails.flatMap(({ seed, submission, claim }) => [
    { seed, submission, claim },
    { seed: submission, submission: seed, claim },
  ]);

  for (const { seed, submission, claim } of rows) {
    it(`${seed} + ${submission} -> does-not-rhyme (${claim})`, () => {
      expect(index.adjudicate(index.pinSeed(seed), submission)).toMatchObject({
        outcome: "rejected",
        reason: "does-not-rhyme",
      });
    });
  }
});
