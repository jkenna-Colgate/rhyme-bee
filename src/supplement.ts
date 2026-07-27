/**
 * The committed pronunciation supplement — the permanent human override layer
 * (ADR-0009). The wordhood set and pronunciations are regenerated from pinned
 * upstream sources on every `npm run build:index`, so a hand-edit to them is
 * wiped on the next build. This small committed file, merged over the upstream
 * inputs at build time, is the ground-truth override that outlives them.
 *
 * It is CMUdict text — the same format as the upstream pronunciations, parsed by
 * the same parser (no second pronunciation format) — with two additions:
 *   - `#`-prefixed lines are comments, so a correction can carry an inline note
 *     explaining why the upstream stress was wrong (a stress change is a
 *     rhyme-verdict change and should stay legible).
 *   - a word absent upstream is *introduced*, and its presence here grants
 *     wordhood; a word already upstream has its pronunciation *overridden*.
 */

import { parseCmudict } from "./cmudict.ts";
import type { Pronunciation } from "./phonology.ts";

export interface SupplementTarget {
  /** Surface form -> its pronunciations (mutated in place). */
  pronunciations: Map<string, Pronunciation[]>;
  /** The wordhood gate (mutated in place); added words are granted wordhood. */
  words: Set<string>;
  /** Proper nouns — read only; the supplement never overrides name-hood. */
  names: ReadonlySet<string>;
}

/** Strip the supplement's `#` comment lines before the CMUdict parser sees them. */
function withoutHashComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/**
 * Merge a committed supplement over the pinned upstream inputs. Each entry
 * asserts an authoritative pronunciation for a word, new or existing:
 *
 *   - the pronunciation **overrides** any upstream reading for that word (a
 *     correction replaces, it does not append a variant alongside);
 *   - the word gains **wordhood**, so a word present only in the supplement is
 *     no longer `not-a-known-word` — *unless* it is a name, which the supplement
 *     never launders into a valid word (name-hood is not overridden).
 *
 * A supplemented word carries no prevalence, so it tiers as a Bonus Word.
 */
export function applySupplement(text: string, target: SupplementTarget): void {
  const supplement = parseCmudict(withoutHashComments(text));
  for (const [word, prons] of supplement) {
    target.pronunciations.set(word, prons);
    if (!target.names.has(word)) target.words.add(word);
  }
}
