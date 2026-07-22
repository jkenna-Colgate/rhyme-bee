/**
 * Curation: answer ADR-0004's open question by exercising the production path.
 * Running `buildPuzzle` over every distinct Rhyme Key yields both the family-size
 * distribution and the candidate Seed Word list — there is no separate analysis
 * tool.
 *
 * Seed Words are keyed by Rhyme Key, not spelling: `late` and `great` are the
 * same Puzzle and appear once, under a chosen representative.
 */

import { rhymeKeyOf, type RhymeKey } from "./phonology.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";

export interface CurationOptions {
  /** Inclusive Answer-count band a shippable Puzzle must fall in. */
  sizeBand: { min: number; max: number };
  /** Rhyme Keys whose pronunciation is unstable across accents — excluded. */
  accentUnstable?: ReadonlySet<RhymeKey>;
  /** Representative word -> note explaining why the Seed is blocked. */
  blocked?: ReadonlyMap<string, string>;
}

export interface FamilyEntry {
  rhymeKey: RhymeKey;
  representative: string;
  answerCount: number;
  bonusCount: number;
  /** True if the representative has more than one pronunciation. */
  multiplePronunciations: boolean;
}

export type DropReason =
  | "below-band"
  | "above-band"
  | "accent-unstable"
  | "blocked";

export interface DroppedEntry {
  rhymeKey: RhymeKey;
  representative: string;
  reason: DropReason;
  note?: string;
}

export interface CurationReport {
  /** Every distinct Rhyme Key with its family size, sorted by Rhyme Key. */
  families: FamilyEntry[];
  /** Answer-count -> how many Rhyme Keys have that many Answers. */
  histogram: Map<number, number>;
  /** Families that fall in the size band and survive exclusions. */
  candidates: FamilyEntry[];
  /** Families excluded from candidacy, with the reason. */
  dropped: DroppedEntry[];
}

/**
 * Choose the representative surface form for a Rhyme Key: prefer an unambiguous
 * word (one pronunciation), then shortest, then alphabetical — deterministic.
 */
function chooseRepresentative(words: string[], index: RhymeIndex): string {
  return [...words].sort((a, b) => {
    const ambiguityA = index.isAmbiguous(a) ? 1 : 0;
    const ambiguityB = index.isAmbiguous(b) ? 1 : 0;
    if (ambiguityA !== ambiguityB) return ambiguityA - ambiguityB;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0]!;
}

export function curate(index: RhymeIndex, options: CurationOptions): CurationReport {
  const accentUnstable = options.accentUnstable ?? new Set<RhymeKey>();
  const blocked = options.blocked ?? new Map<string, string>();

  // Group wordhood-valid words by Rhyme Key (a word contributes to each of its
  // keys). Names are already excluded by `wordhoodEntries`, so no Seed is a name.
  const wordsByKey = new Map<RhymeKey, string[]>();
  for (const [word, prons] of index.wordhoodEntries()) {
    const seen = new Set<RhymeKey>();
    for (const pron of prons) {
      const key = rhymeKeyOf(pron);
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      const bucket = wordsByKey.get(key);
      if (bucket) bucket.push(word);
      else wordsByKey.set(key, [word]);
    }
  }

  const families: FamilyEntry[] = [];
  const histogram = new Map<number, number>();
  const candidates: FamilyEntry[] = [];
  const dropped: DroppedEntry[] = [];

  for (const [rhymeKey, words] of wordsByKey) {
    const representative = chooseRepresentative(words, index);
    const puzzle = index.buildPuzzle({ word: representative, rhymeKey });
    const family: FamilyEntry = {
      rhymeKey,
      representative,
      answerCount: puzzle.answers.length,
      bonusCount: puzzle.bonusWords.length,
      multiplePronunciations: index.isAmbiguous(representative),
    };
    families.push(family);
    histogram.set(family.answerCount, (histogram.get(family.answerCount) ?? 0) + 1);

    const note = blocked.get(representative);
    if (note !== undefined) {
      dropped.push({ rhymeKey, representative, reason: "blocked", note });
    } else if (accentUnstable.has(rhymeKey)) {
      dropped.push({ rhymeKey, representative, reason: "accent-unstable" });
    } else if (family.answerCount < options.sizeBand.min) {
      dropped.push({ rhymeKey, representative, reason: "below-band" });
    } else if (family.answerCount > options.sizeBand.max) {
      dropped.push({ rhymeKey, representative, reason: "above-band" });
    } else {
      candidates.push(family);
    }
  }

  const byKey = (a: { rhymeKey: RhymeKey }, b: { rhymeKey: RhymeKey }) =>
    a.rhymeKey.localeCompare(b.rhymeKey);
  families.sort(byKey);
  candidates.sort(byKey);
  dropped.sort(byKey);
  return { families, histogram, candidates, dropped };
}
