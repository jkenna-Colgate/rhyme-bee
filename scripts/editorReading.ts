/**
 * Pure parser for what an agent says back when the Editor's Pass asks it to
 * author a reading — extracted from the shell for the same reason
 * `editorArgs.ts` was, and following the same precedent (`playArgs.ts`).
 *
 * It is the sole gate on whether a proposal is even considered: a bug here
 * defers every word the compound split could not resolve, silently, and the
 * deferred queue then misattributes the miss to composition. The invocation
 * that produces the text stays untested; only the reading of it moves here.
 *
 * What it accepts is deliberately narrow. `verifyReading` (ADR-0014) bounds the
 * damage a wrong parse can do — nothing reaches `data/supplement.dict` without
 * computing the target Rhyme Key exactly — so the cost of refusing a real
 * reading is one deferred word, and the cost of accepting prose is nothing.
 */

import type { Pronunciation } from "../src/phonology.ts";

/** ARPAbet phoneme, with an optional stress digit. */
const PHONEME = /^[A-Z]{1,3}[012]?$/;

/**
 * The phonemes out of whatever the agent said, or null if that is nothing.
 *
 * The *last* non-empty line, because an agent asked for phonemes and nothing
 * else still sometimes writes a sentence first and the reading last.
 */
export function parseReading(output: string): Pronunciation | null {
  const lines = output.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1] ?? "";
  // `split` never yields an empty array, so a reply with nothing in it arrives
  // here as a single empty token — which is not a phoneme, and is refused as
  // one. There is no separate emptiness check because there is nothing for one
  // to catch.
  const phonemes = last.trim().toUpperCase().split(/\s+/);
  return phonemes.every((p) => PHONEME.test(p)) ? phonemes : null;
}
