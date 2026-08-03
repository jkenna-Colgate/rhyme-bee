/**
 * Curation: answer ADR-0004's open question by exercising the production path.
 * Reading every Rhyme Key's family off the index's single traversal yields both
 * the family-size distribution and the candidate Seed Word list — there is no
 * separate analysis tool, and no second opinion about who belongs to a key.
 *
 * What stays here is curation's own work: the ordered exclusion gates, the
 * representative choice, and the Difficulty sum. Membership, tier judgement and
 * Seed Word exclusion belong to `rhymeIndex.ts`, which is where `buildPuzzle`
 * gets them too.
 *
 * Seed Words are keyed by Rhyme Key, not spelling: `late` and `great` are the
 * same Puzzle and appear once, under a chosen representative.
 */

import type { RhymeKey } from "./phonology.ts";
import { splitFamily, type RhymeIndex } from "./rhymeIndex.ts";
import {
  DEFAULT_SCORING_CONFIG,
  isRare,
  scoreEntry,
  type ScoringConfig,
} from "./scoring.ts";

export interface CurationOptions {
  /** Inclusive Answer-count band a shippable Puzzle must fall in. */
  sizeBand: { min: number; max: number };
  /** Rhyme Keys whose pronunciation is unstable across accents — excluded. */
  accentUnstable?: ReadonlySet<RhymeKey>;
  /** Representative word -> note explaining why the Seed is blocked. */
  blocked?: ReadonlyMap<string, string>;
  /**
   * The scoring config Difficulty is measured in. Difficulty is defined in the
   * game's own Score currency, so it is downstream of scoring: retune the rare
   * cutoff or bonus and the Difficulty ranking shifts (ADR-0007). Defaults to
   * the shipped scoring.
   */
  scoring?: ScoringConfig;
}

export interface FamilyEntry {
  rhymeKey: RhymeKey;
  representative: string;
  answerCount: number;
  bonusCount: number;
  /** True if the representative has more than one pronunciation. */
  multiplePronunciations: boolean;
  /**
   * Difficulty: the share of the family's maximum Score that lives in rare
   * Answers — `rareMass / maxScore`, in 0…1 (ADR-0007). Higher is harder; a
   * common-only player's Rank ceiling is `1 − difficulty`. A family with no
   * Answers (below-band) has no Score to divide, and reports 0.
   */
  difficulty: number;
  /**
   * Native content: the count of family members that are not a derived form —
   * not an inflection or affixation of a word in another Rhyme Key (ADR-0008). A
   * key with zero native content is a Shadow Key (e.g. `downs` = the `down`
   * family with `-s` on every word) and carries no rhyme identity of its own, so
   * it is barred from the Seed pool.
   */
  nativeCount: number;
}

export type DropReason =
  | "below-band"
  | "above-band"
  | "accent-unstable"
  | "blocked"
  | "shadow-key";

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
 * Choose the representative surface form for a Rhyme Key. The representative is
 * the Seed Word the player is *shown and spoken* (ADR-0002), so the only thing
 * that really matters is that it is a word they recognise.
 *
 * Ranked: **native** first (not an inflection or affixation of a word in another
 * key — ADR-0008), then **unambiguous** (one pronunciation, so ADR-0001's pin to
 * exactly one Rhyme Key is honest), then **best known** (ADR-0003 prevalence),
 * then shortest and alphabetical as a deterministic floor.
 *
 * Shortest used to lead, which is why 170 members of `EY N` — `gain`, `drain`,
 * `plane`, `complain` — were represented by `ln`: abbreviations and fragments
 * that hold wordhood are always shorter than the words they abbreviate, so a
 * length-first rule selects for exactly the wrong thing. Knownness alone would
 * fix that but prefers `messed` to `best` and `crowned` to `round`, since an
 * inflected form can out-rank its own stem; native-first settles that.
 */
function chooseRepresentative(words: string[], index: RhymeIndex): string {
  const rank = (word: string) => ({
    derived: index.derivation.isDerived(word) ? 1 : 0,
    ambiguous: index.isAmbiguous(word) ? 1 : 0,
    // Absent from the prevalence norms sorts last, not first.
    knownness: index.tierOf(word).knownness ?? -Infinity,
  });
  return [...words].sort((a, b) => {
    const rankA = rank(a);
    const rankB = rank(b);
    return (
      rankA.derived - rankB.derived ||
      rankA.ambiguous - rankB.ambiguous ||
      rankB.knownness - rankA.knownness ||
      a.length - b.length ||
      a.localeCompare(b)
    );
  })[0]!;
}

/**
 * The default playable Answer-count band a shipped Puzzle's Seed is drawn from.
 * Defined here, next to `curate`, so `play.ts` and the web shell share one
 * default rather than each re-declaring 20 / 120 (`play` still lets BAND_MIN /
 * BAND_MAX override it). Mirrors ADR-0004: Puzzle size is bounded by curation.
 */
export const DEFAULT_PLAYABLE_BAND: { min: number; max: number } = { min: 20, max: 120 };

/**
 * The in-band Seed pool: the candidate families whose Answer count lands in the
 * playable size band and survive every exclusion (accent-unstable, blocked,
 * Shadow Key). This is the single shared draw both the `play` REPL and the web
 * shell read from; each caller then does its own thing with the pool — the
 * random pick, `--day` Difficulty bucketing, reading the Seed off a family, the
 * banner — so those legitimately stay in the caller. Pure and deterministic:
 * `curate` sorts the candidates by Rhyme Key.
 */
export function playableSeeds(
  index: RhymeIndex,
  band: { min: number; max: number } = DEFAULT_PLAYABLE_BAND,
): FamilyEntry[] {
  return curate(index, { sizeBand: band }).candidates;
}

export function curate(index: RhymeIndex, options: CurationOptions): CurationReport {
  const accentUnstable = options.accentUnstable ?? new Set<RhymeKey>();
  const blocked = options.blocked ?? new Map<string, string>();
  const scoring = options.scoring ?? DEFAULT_SCORING_CONFIG;
  // Derivation is asked of the index rather than assembled here: a member is
  // derived only relative to the very words and readings this index holds
  // (ADR-0008, and the sound gate of issue #97).
  const derivation = index.derivation;

  // One traversal, one family per Rhyme Key. Membership, tier judgement and Seed
  // Word exclusion are the index's to define — this used to hand-inline an
  // equivalent pass, because building a Puzzle per key re-scans every wordhood
  // word (O(keys × words)), and the two were kept in agreement by a comment.
  // Names are already excluded upstream, so no Seed is a name.
  const families: FamilyEntry[] = [];
  const histogram = new Map<number, number>();
  const candidates: FamilyEntry[] = [];
  const dropped: DroppedEntry[] = [];

  for (const rhymeFamily of index.families().values()) {
    const { rhymeKey, members } = rhymeFamily;
    const representative = chooseRepresentative(
      members.map((member) => member.word),
      index,
    );
    const { answers, bonusWords } = splitFamily(rhymeFamily, representative);

    // Native content counts every member — including the representative —
    // since a Shadow Key is one whose *whole* family is derived, Seed included.
    let nativeCount = 0;
    for (const member of members) {
      if (!derivation.isDerived(member.word)) nativeCount++;
    }

    // Difficulty from the shared per-Answer points (`scoreEntry`, so the
    // `1 − difficulty` identity stays exact): the rare-only mass over the
    // whole maximum achievable Score (ADR-0007).
    let maxScore = 0;
    let rareMass = 0;
    for (const answer of answers) {
      const points = scoreEntry(
        { length: answer.length, knownness: answer.knownness },
        scoring,
      );
      maxScore += points;
      if (isRare(answer.knownness, scoring)) rareMass += points;
    }

    const family: FamilyEntry = {
      rhymeKey,
      representative,
      answerCount: answers.length,
      bonusCount: bonusWords.length,
      multiplePronunciations: index.isAmbiguous(representative),
      difficulty: maxScore === 0 ? 0 : rareMass / maxScore,
      nativeCount,
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
    } else if (family.nativeCount === 0) {
      // In-band but a pure Shadow Key: no native rhyme content, so it is a rerun
      // of the base key in a different suit. The distinctness gate, orthogonal to
      // the size gate above (ADR-0008 refining ADR-0004).
      dropped.push({ rhymeKey, representative, reason: "shadow-key" });
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
