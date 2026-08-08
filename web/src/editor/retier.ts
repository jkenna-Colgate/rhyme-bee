/**
 * The day as the Tier picker sees it: the two lists with every standing verdict
 * applied, and the three figures re-measured off the result.
 *
 * ## Why the browser recomputes at all
 *
 * `editorDayPlugin` sends the day as the *built* index reads it, and ADR-0016's
 * position is that the browser computes nothing. This module is the deliberate
 * exception, and the reason is that a verdict is written to
 * `data/tier-overrides.csv` the instant it is clicked but only reaches the index
 * at the next `npm run build:index`. Between those two moments the artifact on
 * disk is stale by exactly the judgements the editor has just made, and the
 * whole point of the picker is to *watch the day move* — Difficulty and maximum
 * Score responding to a judgement is how an editor knows whether they have
 * spoiled a day. A screen that showed yesterday's figures until a rebuild would
 * be a screen with no feedback in it.
 *
 * ## Why that does not reintroduce a second opinion
 *
 * The figures are **exact, not approximate**, because nothing here restates the
 * engine's arithmetic:
 *
 * - The Answer/Bonus line is `tierFor`, the engine's own comparison, against the
 *   threshold the built index carries.
 * - The three figures are `measureAnswers`, called on the rearranged list — which
 *   is why `DayWord extends Scorable` (#155): a re-tiered day feeds straight back
 *   in and lands on `scoreEntry`, the rare cutoff and the Difficulty ratio the
 *   engine uses, rather than on a copy of the formula written in TSX.
 * - The lemma walk that finds a word's knownness is *not* rerun here. Each word
 *   arrives with the ordered candidate list `RhymeIndex#tier` would consult, and
 *   the measured value of each candidate that has a prevalence row of its own,
 *   both computed in Node by the index's own `Derivation` (see
 *   `web/editorTierPayload.ts`). All this module does with them is take the first
 *   candidate that has a value, which is what the build does with the same list.
 *
 * `web/__tests__/retier.test.ts` holds that claim to account the only way worth
 * doing: every case builds the fixture index a second time with the override
 * file under test and asserts that a rebuild lands where this module said it
 * would.
 *
 * ## Why the override map is not a working set
 *
 * There is no local edit buffer. Every verdict is on disk before it is on the
 * screen, so the standing verdicts this module applies are always the file's,
 * refreshed from the endpoint's reply to the write. ADR-0015 is explicit that
 * closing the tab must never cost judgement already made, and the way to
 * guarantee that is to have nothing to lose — an optimistic local copy would be
 * a second state that can disagree with the file, in a tool whose entire output
 * *is* the file.
 */

import { measureAnswers } from "../../../src/curation.ts";
import type { PuzzleFacts } from "../../../src/schedule.ts";
import {
  VERDICT_VALUE,
  type TierOverrideRow,
  type TierVerdict,
} from "../../../src/tierOverride.ts";
import { tierFor } from "../../../src/verdict.ts";
import type { DayWord } from "../../../scripts/editorDay.ts";

/** The two lists of a day, which is all of a readout this module touches. */
export interface DayLists {
  answers: DayWord[];
  bonusWords: DayWord[];
}

/** One word's standing verdict in `data/tier-overrides.csv`, last row winning. */
export interface StandingVerdict {
  word: string;
  verdict: TierVerdict;
  /** How many rows the word carries. More than one means it was reversed. */
  rows: number;
  /** When the standing row was written (ISO 8601). */
  decided: string;
  /** What prevalence said when that row was written; null for no row at all. */
  measured: number | null;
}

/**
 * How one word's knownness is looked up: the ordered candidates
 * `RhymeIndex#tier` walks, surface form first. Computed in Node by the index's
 * own `Derivation`, never in the browser — spelling alone gets this wrong
 * (`has` is not an inflection of `ha`), and the browser has no readings to check
 * it against.
 */
export interface KnownnessLookup {
  word: string;
  candidates: string[];
}

/** Everything the picker needs that the day readout does not already carry. */
export interface TierPickerState {
  /** The day this state was built for, so a stale reply can be discarded. */
  date: string;
  standing: StandingVerdict[];
  lookups: KnownnessLookup[];
  /** Measured prevalence, for every candidate above that has a row of its own. */
  measured: Record<string, number>;
  /** The Answer/Bonus line the built index carries. */
  knownnessThreshold: number;
}

/**
 * What the endpoint answers an accepted judgement with.
 *
 * Declared here rather than beside the endpoint that builds it, because the
 * browser cannot import that module — it opens files and reads the index — and
 * two declarations of one wire shape is exactly the pair that drifts.
 */
export interface TierWriteResult {
  /** The file's own state, re-read after the row landed. */
  state: TierPickerState;
  /** The row as written — the audit trail's record, shown rather than described. */
  appended: TierOverrideRow;
  /**
   * Every other word in the index this judgement now governs: the lemma-family
   * reach, reported because it is accepted behaviour and must not be a surprise.
   */
  reach: string[];
}

/** A day word with what the picker knows about the judgement standing on it. */
export interface RetieredWord extends DayWord {
  /** The verdict standing on this very word, or null if the file never named it. */
  verdict: TierVerdict | null;
  /** Rows this word carries. More than one is a reversal, and is flagged. */
  rows: number;
  /**
   * The word whose value supplied this one's knownness — itself, when it has a
   * prevalence row or a verdict of its own, and otherwise the lemma it fell back
   * to. `null` when nothing in the chain had a value at all, which is the
   * absent-from-the-data default that tiers to Bonus Word.
   */
  source: string | null;
  /** The verdict standing on `source`, when `source` is another word. */
  sourceVerdict: TierVerdict | null;
}

export interface RetieredDay {
  answers: RetieredWord[];
  bonusWords: RetieredWord[];
  /** Answer count, maximum Score and Difficulty, re-measured off the lists above. */
  facts: PuzzleFacts;
}

/**
 * The day with every standing verdict applied and the figures re-measured.
 *
 * A word missing from `lookups` keeps the knownness the readout gave it. That is
 * a payload that has drifted from the day rather than a case worth designing
 * for, and the honest fallback is the figure Node computed — not a guess and not
 * a hole in the list.
 */
export function retierDay(lists: DayLists, state: TierPickerState): RetieredDay {
  const standing = new Map(state.standing.map((row) => [row.word, row]));
  const candidatesOf = new Map(state.lookups.map((l) => [l.word, l.candidates]));

  /**
   * The value a candidate carries now: its verdict's sentinel if it has one, and
   * otherwise its measured prevalence. A `none` verdict patches nothing at all —
   * it neither writes a value nor removes one — so it falls through to the
   * measurement, which is exactly what `applyTierOverrides` does at build time.
   */
  const valueOf = (candidate: string): number | undefined => {
    const verdict = standing.get(candidate)?.verdict;
    if (verdict !== undefined && verdict !== "none") return VERDICT_VALUE[verdict];
    return state.measured[candidate];
  };

  const retier = (entry: DayWord): RetieredWord => {
    const own = standing.get(entry.word);
    let knownness = entry.knownness;
    let source: string | null = null;

    const candidates = candidatesOf.get(entry.word);
    if (candidates !== undefined) {
      knownness = null;
      for (const candidate of candidates) {
        const value = valueOf(candidate);
        if (value !== undefined) {
          knownness = value;
          source = candidate;
          break;
        }
      }
    }

    return {
      word: entry.word,
      length: entry.length,
      knownness,
      verdict: own?.verdict ?? null,
      rows: own?.rows ?? 0,
      source,
      sourceVerdict:
        source === null || source === entry.word ? null : standing.get(source)?.verdict ?? null,
    };
  };

  const answers: RetieredWord[] = [];
  const bonusWords: RetieredWord[] = [];
  for (const entry of [...lists.answers, ...lists.bonusWords]) {
    const word = retier(entry);
    // A word absent from the prevalence data always tiers to Bonus (ADR-0003),
    // which is the index's rule and not a second one: `tierFor` takes a number,
    // so the null case is answered before it is asked.
    const tier =
      word.knownness === null ? "bonus" : tierFor(word.knownness, state.knownnessThreshold);
    (tier === "answer" ? answers : bonusWords).push(word);
  }

  return { answers, bonusWords, facts: measureAnswers(answers) };
}
