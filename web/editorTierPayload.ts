/**
 * What Node has to tell the browser before the Tier picker can move a word: the
 * standing verdicts in `data/tier-overrides.csv`, and — for every word in the
 * day — the lemma candidates its knownness is looked up under, with the measured
 * prevalence of each candidate that has a row of its own.
 *
 * ## Why the lemma walk is computed here and not there
 *
 * A word's knownness is not read off its own spelling. `RhymeIndex#tier` walks
 * `Derivation.lemmaCandidates` and takes the first candidate the prevalence data
 * knows, which is why `gates` scores as `gate` and why an override on a lemma
 * reaches the derived forms that have no row of their own. Reproducing that walk
 * in the browser would mean reproducing `Derivation`, and `Derivation` is not a
 * spelling rule: it checks that a short `-s` form *sounds* like its base plus an
 * S, against readings the browser does not have and would have to be sent
 * fifteen megabytes to get. So the walk runs once, in Node, over the index that
 * is already open, and the browser is handed its answer.
 *
 * That leaves the browser with the one step it genuinely has to simulate —
 * *which* candidate wins once a verdict has planted a value — and that step is
 * three lines with no arithmetic in it. See `web/src/editor/retier.ts`.
 *
 * ## Why `measured` is read from `data/prevalence.csv` and not from the index
 *
 * The built index's prevalence map has already had the override layer merged
 * into it (`applyTierOverrides` runs at build time), so a word judged on an
 * earlier visit reads back as its sentinel — `-3.0`, not the 1.2119 the data
 * actually said. Recording that as `measured` would turn ADR-0015's audit trail
 * into a record of the editor's own previous opinion, and withdrawing a verdict
 * with `none` would restore a value prevalence never held. The pinned norms are
 * the only honest source for both, so this module is handed them directly.
 */

import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { parseTierOverrides, resolveTierOverrides } from "../src/tierOverride.ts";
import type {
  DayLists,
  KnownnessLookup,
  StandingVerdict,
  TierPickerState,
} from "./src/editor/retier.ts";

export interface TierPickerInput {
  /** The day the lists belong to, echoed back so a stale reply can be discarded. */
  date: string;
  /**
   * The index's own `Derivation.lemmaCandidates`, passed as a function rather
   * than as an index so that a date the run does not cover is answered without
   * opening fifteen megabytes — the same call `readScheduledDay` makes about the
   * index for the same reason. Empty lists never ask it anything.
   */
  lemmaCandidates: (word: string) => string[];
  lists: DayLists;
  /** The pinned prevalence norms, parsed and *unpatched*. */
  measured: ReadonlyMap<string, number>;
  /** `data/tier-overrides.csv` as text; empty when no pass has ever written it. */
  overrides: string;
  /** The Answer/Bonus line the built index carries. */
  knownnessThreshold: number;
}

/**
 * The picker's state for one day.
 *
 * `standing` is the *whole* file rather than the day's slice of it, on purpose:
 * an override on a lemma governs derived forms that sit on other days, so the
 * verdict currently setting a listed word's knownness is often a row naming a
 * word this day never mentions. Sending only the day's own words would leave the
 * browser unable to say why `gates` is a Bonus Word. The file is a few hundred
 * rows at the outside and a day's readout is already larger.
 *
 * `measured` is narrowed to the candidates this day actually walks — the norms
 * are 62k rows and the browser needs the handful the day can reach.
 */
export function tierPickerState(input: TierPickerInput): TierPickerState {
  const lookups: KnownnessLookup[] = [];
  const measured: Record<string, number> = {};

  for (const entry of [...input.lists.answers, ...input.lists.bonusWords]) {
    const candidates = input.lemmaCandidates(entry.word);
    lookups.push({ word: entry.word, candidates });
    for (const candidate of candidates) {
      const value = input.measured.get(candidate);
      if (value !== undefined) measured[candidate] = value;
    }
  }

  const standing: StandingVerdict[] = [];
  for (const [word, resolved] of resolveTierOverrides(parseTierOverrides(input.overrides))) {
    standing.push({
      word,
      verdict: resolved.verdict,
      rows: resolved.rows,
      decided: resolved.decided,
      measured: resolved.measured,
    });
  }

  return {
    date: input.date,
    standing,
    lookups,
    measured,
    knownnessThreshold: input.knownnessThreshold,
  };
}

/**
 * Every other word in the index whose knownness now resolves through `word` —
 * the reach of a judgement on it.
 *
 * This is the behaviour #157 pinned and the maintainer has ruled **accepted**:
 * overriding `gate` re-tiers `gates`, because a derived form with no prevalence
 * row of its own has always fallen back to its lemma's, long before overrides
 * existed. The narrow alternative would need adjudication to treat an overridden
 * value differently from a measured one, which ADR-0015 forbids.
 *
 * Accepted is not the same as invisible, which is why this exists. It is
 * computed over the *whole* index rather than over the day on screen, and that
 * is the point: a lemma and its inflections almost never share a Rhyme Key —
 * `gate` is /eɪt/ and `gates` is /eɪts/ — so the words a judgement reaches are
 * nearly always on **other days**, where the editor would never see them move.
 * A reach confined to the day would report nothing and be worse than useless: it
 * would read as a promise that nothing else was touched.
 *
 * One pass over the wordhood-valid vocabulary per judgement, on a localhost dev
 * server, at the moment a human clicks. Nothing is cached, because the answer
 * changes with every write to the file and a stale reach is a lie about what
 * just happened.
 */
export function reachOf(
  word: string,
  index: RhymeIndex,
  values: (candidate: string) => number | undefined,
): string[] {
  const reached: string[] = [];
  for (const [candidateWord] of index.wordhoodEntries()) {
    if (candidateWord === word) continue;
    for (const candidate of index.derivation.lemmaCandidates(candidateWord)) {
      if (values(candidate) === undefined) continue;
      if (candidate === word) reached.push(candidateWord);
      break;
    }
  }
  return reached.sort();
}
