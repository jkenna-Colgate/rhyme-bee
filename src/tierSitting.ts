/**
 * The Tier sitting (#309, under #307): the maintainer marks a sample of Answers
 * by Retrieval, with each word's knownness hidden, and both lines are placed
 * from the marks.
 *
 * Each word gets one of three marks. **E** (easy): most players would think of
 * it. **H** (hard find): some would, with effort. **B** (Bonus): a real word
 * nobody hunting rhymes would come up with. The Answer line goes where B stops
 * being the majority and the rare line where E becomes it.
 *
 * This module is the whole of the sitting's logic: the draw, the placement, the
 * comparison of signals, and what the placed lines would do to the Schedule.
 * The page that takes the marks and the two commands (`scripts/tier-sitting.ts`)
 * are shells over it. Nothing here writes: the built index and the Schedule are
 * read and never changed.
 */

import { DEFAULT_PLAYABLE_BAND, measureAnswers } from "./curation.ts";
import { standingVerdict, TIER_MARKS, type LabelSet } from "./judgeLabels.ts";
import { weekdayOf, type PuzzleFacts } from "./schedule.ts";
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from "./scoring.ts";
import { verdictForValue } from "./tierOverride.ts";
import { tierFor, type Tier } from "./verdict.ts";

/** One Answer on a scheduled day, as the built index holds it. */
export interface SittingAnswer {
  word: string;
  length: number;
  /**
   * Knownness as built. An editor's Tier verdict (or a Session Record move)
   * compiles to a sentinel value (`VERDICT_VALUE`), which is read back here as
   * the verdict rather than as a measurement.
   */
  knownness: number | null;
}

/** A scheduled day, with the Answers its Puzzle holds today. */
export interface SittingDay {
  date: string;
  week: number;
  seedWord: string;
  rhymeKey: string;
  seedKnownness: number | null;
  answers: SittingAnswer[];
}

/** One word to mark, and the Seed Word it is shown with. */
export interface SittingItem {
  word: string;
  seedWord: string;
  rhymeKey: string;
}

export interface BandOptions {
  /** The lower edge of the lowest band. */
  from: number;
  /** The upper edge of the highest band, exclusive. */
  to: number;
  width: number;
}

export const SITTING_BANDS: BandOptions = { from: 0, to: 2.5, width: 0.25 };

export interface DrawOptions {
  bands: BandOptions;
  perBand: number;
  /** The fixed seed, so the same build draws the same sample. */
  seed: number;
}

export const DEFAULT_DRAW: DrawOptions = { bands: SITTING_BANDS, perBand: 15, seed: 309 };

/** A small seeded generator (mulberry32): the draw must repeat exactly, so `Math.random` will not do. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The number of bands the options cut. */
export function bandCount(bands: BandOptions): number {
  return Math.round((bands.to - bands.from) / bands.width);
}

/** The band a knownness falls in, or null outside the banded range. */
export function bandOf(knownness: number, bands: BandOptions): number | null {
  if (knownness < bands.from || knownness >= bands.to) return null;
  return Math.min(bandCount(bands) - 1, Math.floor((knownness - bands.from) / bands.width + 1e-9));
}

/** The lower edge of a band. */
export function bandEdge(band: number, bands: BandOptions): number {
  return Number((bands.from + band * bands.width).toFixed(6));
}

/** A knownness that was measured, rather than compiled from a verdict. */
export function measured(knownness: number | null): knownness is number {
  return knownness !== null && verdictForValue(knownness) === null;
}

/**
 * Draw the sample: up to `perBand` Answers from each band, from the scheduled
 * days' Puzzles, shuffled across bands so the order says nothing about
 * knownness. A word that is an Answer on several days is drawn once, with one
 * of those days' Seed Words. Words carrying a verdict are left out: their value
 * says what the editor decided, not how well the word is known.
 */
export function drawSample(days: readonly SittingDay[], opts: DrawOptions = DEFAULT_DRAW): SittingItem[] {
  const random = seeded(opts.seed);
  const byWord = new Map<string, { band: number; days: SittingDay[] }>();
  for (const d of days) {
    for (const a of d.answers) {
      if (!measured(a.knownness)) continue;
      const band = bandOf(a.knownness, opts.bands);
      if (band === null) continue;
      const seen = byWord.get(a.word);
      if (seen) seen.days.push(d);
      else byWord.set(a.word, { band, days: [d] });
    }
  }
  const words = [...byWord.keys()].sort();
  const chosen: SittingItem[] = [];
  for (let band = 0; band < bandCount(opts.bands); band++) {
    const inBand = words.filter((w) => byWord.get(w)!.band === band);
    for (const word of shuffle(inBand, random).slice(0, opts.perBand)) {
      const on = byWord.get(word)!.days;
      const d = on[Math.floor(random() * on.length)]!;
      chosen.push({ word, seedWord: d.seedWord, rhymeKey: d.rhymeKey });
    }
  }
  return shuffle(chosen, random);
}

// ---- placement ----------------------------------------------------------------

/** The three marks, as the marks file spells them. */
export type Mark = (typeof TIER_MARKS)[number];

/** One marked word, with what the index measures of it at placement time. */
export interface MarkedWord {
  word: string;
  /** Knownness read from the built index when the lines are placed, never shown at the sitting. */
  knownness: number;
  /** Word frequency (Zipf, US) from the same prevalence data, read through the same stem; null without a row. */
  frequency: number | null;
  mark: Mark;
}

/** One band's marks. */
export interface BandTally {
  band: number;
  /** Its lower edge. */
  from: number;
  easy: number;
  hardFind: number;
  bonus: number;
}

export interface PlacedLines {
  bands: BandTally[];
  /**
   * The lower edge of the lowest band in which fewer than half the words are B,
   * with every band above it agreeing. Null when the highest marked band is
   * itself half or more B, so no band can carry the line.
   */
  answerLine: number | null;
  /**
   * The lower edge of the lowest band, at or above the Answer line, in which
   * more than half the words are E. A band below the Answer line holds no
   * Answers to be rare. Null when no band has an E majority: the H marks are
   * too noisy to place it, and the rare share line stands in.
   */
  rareLine: number | null;
  /** The rare line that keeps today's share of Answers rare, given the placed Answer line. */
  rareShareLine: number;
  /** Today's share of scheduled Answers that are rare, which `rareShareLine` keeps. */
  rareShare: number;
  /**
   * The lines the consequences are measured at: the placed ones, with the rare
   * share line where no rare line could be placed, and the top of the sitting
   * where no Answer line could be.
   */
  inForce: Lines;
}

/** An Answer line and a rare line. */
export interface Lines {
  /** A knownness at or above it makes an Answer. */
  answerLine: number;
  /** An Answer whose knownness sits below it is rare. */
  rareLine: number;
}

/** What placement measures the marks against: the scheduled days, and the lines they are tiered at today. */
export interface PlacementContext {
  days: readonly SittingDay[];
  today: Lines;
}

/**
 * The measured knownness of every Answer slot on the scheduled days. Words
 * carrying a verdict are left out of a share: the verdict, not the line, sets
 * their Tier and rarity.
 */
function measuredAnswers(days: readonly SittingDay[]): number[] {
  return days.flatMap((d) => d.answers.map((a) => a.knownness).filter(measured));
}

/**
 * The share of today's Answers that are rare, and the rare line that keeps
 * that share above a new Answer line: midway between the last word that stays
 * rare and the first that does not.
 */
export function rareShareLine(days: readonly SittingDay[], today: Lines, answerLine: number): { share: number; line: number } {
  const all = measuredAnswers(days);
  const answersToday = all.filter((k) => k >= today.answerLine);
  const share = answersToday.length === 0 ? 0 : answersToday.filter((k) => k < today.rareLine).length / answersToday.length;
  const pool = all.filter((k) => k >= answerLine).sort((a, b) => a - b);
  const q = Math.floor(share * pool.length);
  if (q === 0) return { share, line: answerLine };
  if (q >= pool.length) return { share, line: pool[pool.length - 1]! + 1e-6 };
  return { share, line: (pool[q - 1]! + pool[q]!) / 2 };
}

function tallyBands(marks: readonly MarkedWord[], bands: BandOptions): BandTally[] {
  const tallies: BandTally[] = [];
  for (let band = 0; band < bandCount(bands); band++) tallies.push({ band, from: bandEdge(band, bands), easy: 0, hardFind: 0, bonus: 0 });
  for (const m of marks) {
    const band = bandOf(m.knownness, bands);
    if (band === null) continue;
    const t = tallies[band]!;
    if (m.mark === "easy") t.easy++;
    else if (m.mark === "hard-find") t.hardFind++;
    else t.bonus++;
  }
  return tallies;
}

const total = (t: BandTally) => t.easy + t.hardFind + t.bonus;

/**
 * The marks file is a label set asking the tier question, saved beside the
 * Judge's labels in `data/judge-labels/` and read by the same parser, so it
 * names its labeller on every mark (`judgeLabels.ts`). This is one labeller's
 * standing mark on each word, in file order; a word left unmarked is skipped.
 */
export function marksOf(set: LabelSet, labeller: string): { word: string; seedWord: string; mark: Mark }[] {
  if (set.question !== "tier") throw new Error(`${set.set} asks the ${set.question} question, not the tier question`);
  return set.pairs.flatMap((p) => {
    const v = standingVerdict(p, labeller, { blindOnly: true });
    return v ? [{ word: p.word, seedWord: p.seedWord, mark: v.verdict as Mark }] : [];
  });
}

/** Place both lines from the marks. A band nobody marked says nothing either way, and is passed over. */
export function placeLines(
  context: PlacementContext,
  marks: readonly MarkedWord[],
  bands: BandOptions = SITTING_BANDS,
): PlacedLines {
  const tallies = tallyBands(marks, bands);
  const marked = tallies.filter((t) => total(t) > 0);
  // A tie goes to Bonus Word: play can promote it, and nothing demotes an Answer.
  let answerLine: number | null = null;
  for (let i = marked.length - 1; i >= 0; i--) {
    const t = marked[i]!;
    if (t.bonus * 2 >= total(t)) break;
    answerLine = t.from;
  }
  const answerLineInForce = answerLine ?? bands.to;
  const rareLine = marked.find((t) => t.from >= answerLineInForce && t.easy * 2 > total(t))?.from ?? null;
  const share = rareShareLine(context.days, context.today, answerLineInForce);
  return {
    bands: tallies,
    answerLine,
    rareLine,
    rareShareLine: share.line,
    rareShare: share.share,
    inForce: { answerLine: answerLineInForce, rareLine: rareLine ?? share.line },
  };
}

// ---- which signal separates the marks -------------------------------------------

/**
 * How well a signal agrees with the marks, two ways. `agreement` is in sample:
 * the cut is fitted to every mark and scored on the same marks, so a signal with
 * more cuts to tune scores higher whether or not it predicts better. `heldOut`
 * is leave-one-out: each mark is scored by the cut fitted to all the others,
 * which is the figure that says how the signal would do on marks not yet given.
 */
export interface SignalScore {
  agreement: number;
  heldOut: number;
}

/** A single cut on one signal, fitted to every mark: a word below it is called B. */
export interface SignalCut extends SignalScore {
  cut: number;
}

export interface SignalComparison {
  knownness: SignalCut;
  frequency: SignalCut;
  /** Knownness as a minimum, with frequency deciding above it: B when below either. */
  combined: SignalScore & { knownnessMinimum: number; frequencyCut: number };
  /**
   * The combined signal's score minus knownness alone's. The combined signal
   * holds every knownness cut as a special case, so in sample it can never
   * fall below knownness; only the held-out margin can say it predicts better.
   */
  combinedOverKnownness: SignalScore;
}

/** Ascending, with -Infinity (no frequency) safe to compare. */
const ascending = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every cut worth trying on a signal, as the values fitted fall: one that calls
 * nothing B (-Infinity), one midway between each pair of neighbouring values
 * (a cut calls B everything strictly below it), and one that calls everything B
 * (Infinity). Midway, so a held-out word between two fitted values is called
 * by whichever it sits nearer. Just above a word with no frequency, the cut
 * sits at the next value up.
 */
function cutsOf(values: readonly number[]): number[] {
  const distinct = [...new Set(values)].sort(ascending);
  const cuts = [-Infinity];
  for (let i = 1; i < distinct.length; i++) {
    const below = distinct[i - 1]!;
    cuts.push(Number.isFinite(below) ? (below + distinct[i]!) / 2 : distinct[i]!);
  }
  cuts.push(Infinity);
  return cuts;
}

/** The best cut on one signal over the `fit` marks, by how many it agrees with; of equally good cuts, the lowest. */
function fitCut(values: readonly number[], isB: readonly boolean[], fit: readonly number[]): { cut: number; agreed: number } {
  let best = { cut: -Infinity, agreed: -1 };
  for (const cut of cutsOf(fit.map((i) => values[i]!))) {
    let agreed = 0;
    for (const i of fit) if (values[i]! < cut === isB[i]) agreed++;
    if (agreed > best.agreed) best = { cut, agreed };
  }
  return best;
}

/**
 * The best knownness minimum and frequency cut over the `fit` marks: the
 * lowest minimum, then the lowest cut, of equally good pairs. For each minimum,
 * the words at or above it are swept once in frequency order.
 */
function fitCombined(
  k: readonly number[],
  f: readonly number[],
  isB: readonly boolean[],
  fit: readonly number[],
): { knownnessMinimum: number; frequencyCut: number; agreed: number } {
  const byFrequency = [...fit].sort((a, b) => ascending(f[a]!, f[b]!));
  const frequencyCuts = cutsOf(fit.map((i) => f[i]!));
  let best = { knownnessMinimum: -Infinity, frequencyCut: -Infinity, agreed: -1 };
  for (const knownnessMinimum of cutsOf(fit.map((i) => k[i]!))) {
    // Below the minimum a word is called B whatever its frequency; above it, frequency decides.
    let belowAgreed = 0;
    let aboveNotB = 0;
    for (const i of fit) {
      if (k[i]! < knownnessMinimum) belowAgreed += isB[i] ? 1 : 0;
      else aboveNotB += isB[i] ? 0 : 1;
    }
    let next = 0;
    let calledBRight = 0;
    let calledBWrong = 0;
    for (const frequencyCut of frequencyCuts) {
      for (; next < byFrequency.length && f[byFrequency[next]!]! < frequencyCut; next++) {
        const i = byFrequency[next]!;
        if (k[i]! < knownnessMinimum) continue;
        if (isB[i]) calledBRight++;
        else calledBWrong++;
      }
      const agreed = belowAgreed + calledBRight + aboveNotB - calledBWrong;
      if (agreed > best.agreed) best = { knownnessMinimum, frequencyCut, agreed };
    }
  }
  return best;
}

/** Leave-one-out: the share of marks a rule fitted to all the other marks calls right. */
function heldOut(isB: readonly boolean[], calledBWithout: (held: number, fit: number[]) => boolean): number {
  const all = isB.map((_, i) => i);
  let agreed = 0;
  for (const held of all) if (calledBWithout(held, all.filter((i) => i !== held)) === isB[held]) agreed++;
  return all.length === 0 ? 0 : agreed / all.length;
}

/**
 * How well each signal, on its own and together, separates the B marks from
 * the E and H marks: the best single cut for each, the share of marks it agrees
 * with in sample, and the share held out. Of equally good cuts the lowest is
 * reported. A word with no frequency reads as less frequent than any word that
 * has one.
 */
export function compareSignals(marks: readonly MarkedWord[]): SignalComparison {
  const isB = marks.map((m) => m.mark === "bonus");
  const k = marks.map((m) => m.knownness);
  const f = marks.map((m) => m.frequency ?? -Infinity);
  const all = marks.map((_, i) => i);
  const share = (agreed: number) => (marks.length === 0 ? 0 : agreed / marks.length);

  const single = (values: number[]): SignalCut => {
    const fitted = fitCut(values, isB, all);
    return {
      cut: fitted.cut,
      agreement: share(fitted.agreed),
      heldOut: heldOut(isB, (held, fit) => values[held]! < fitCut(values, isB, fit).cut),
    };
  };
  const knownness = single(k);
  const fitted = fitCombined(k, f, isB, all);
  const combined = {
    knownnessMinimum: fitted.knownnessMinimum,
    frequencyCut: fitted.frequencyCut,
    agreement: share(fitted.agreed),
    heldOut: heldOut(isB, (held, fit) => {
      const rule = fitCombined(k, f, isB, fit);
      return k[held]! < rule.knownnessMinimum || f[held]! < rule.frequencyCut;
    }),
  };
  return {
    knownness,
    frequency: single(f),
    combined,
    combinedOverKnownness: { agreement: combined.agreement - knownness.agreement, heldOut: combined.heldOut - knownness.heldOut },
  };
}

// ---- what the placed lines would do ---------------------------------------------

/** An unscheduled family from the Seed pool, with its Answers as built. */
export interface PoolFamily {
  seedWord: string;
  rhymeKey: string;
  seedKnownness: number | null;
  answers: SittingAnswer[];
}

export interface ConsequenceContext {
  days: readonly SittingDay[];
  /** The unscheduled Seed pool, where a day to replace looks for a replacement. */
  pool: readonly PoolFamily[];
}

export interface DayAtLines {
  date: string;
  week: number;
  seedWord: string;
  rhymeKey: string;
  seedKnownness: number | null;
  answerCount: number;
  difficulty: number;
}

/**
 * A scheduled Answer the lines make a Bonus Word. Only today's Answers are
 * measured, so a Tier can change in this direction alone.
 */
export interface AnswerToBonus {
  word: string;
  knownness: number;
}

/**
 * A day with fewer Answers than this is replaced, with a Seed Word the
 * maintainer picks (#307). A day under the size band's floor but not under
 * this is accepted: play grows it back as Bonus Words are promoted.
 */
export const REPLACE_DAY_UNDER = 10;

export interface Consequences {
  /** Every scheduled Answer the lines make a Bonus Word, once per word. */
  answersToBonus: AnswerToBonus[];
  days: DayAtLines[];
  /** Days under the size band's floor (`DEFAULT_PLAYABLE_BAND.min`). */
  daysUnderBand: DayAtLines[];
  /** Days under `REPLACE_DAY_UNDER`, which are replaced. */
  daysToReplace: DayAtLines[];
  seedWordsBelowLine: DayAtLines[];
  difficultyZero: DayAtLines[];
  /** The weeks, of more than one day, whose Difficulty no longer rises Monday to Sunday. */
  weeksOutOfRamp: number[];
  replacements: { date: string; seedWord: string; candidates: string[] }[];
}

export interface ConsequenceOptions {
  scoring: ScoringConfig;
  /** How many replacement Seed Words to offer for each day to replace. */
  replacementsPerDay: number;
  /** A replacement must hold at least this many Answers at the lines: the size band's floor. */
  replacementMinAnswers: number;
}

export const DEFAULT_CONSEQUENCE_OPTIONS: ConsequenceOptions = {
  scoring: DEFAULT_SCORING_CONFIG,
  replacementsPerDay: 5,
  replacementMinAnswers: DEFAULT_PLAYABLE_BAND.min,
};

/** The scoring config with its rare line moved to the candidate one. */
const scoringAt = (lines: Lines, scoring: ScoringConfig): ScoringConfig => ({ ...scoring, rareKnownnessCutoff: lines.rareLine });

/**
 * A built value as it would read at the candidate lines. The `bonus` and
 * `answer-common` sentinels sit outside every line the sitting can place, so
 * they read as they are. The `answer-rare` sentinel moves with the lines, to
 * sit between them (#307), so it is read at the Answer line itself: an Answer,
 * and rare whenever the rare line sits above the Answer line.
 */
function valueAt(knownness: number, lines: Lines): number {
  return verdictForValue(knownness) === "answer-rare" ? lines.answerLine : knownness;
}

/**
 * A word's Tier at a pair of lines, by the index's own comparison (`tierFor`).
 * A word with no knownness is a Bonus Word at any lines (ADR-0003).
 */
function tierAt(knownness: number | null, lines: Lines): Tier {
  return knownness === null ? "bonus" : tierFor(valueAt(knownness, lines), lines.answerLine);
}

/**
 * A family's Answers at the lines, measured by the one Difficulty definition
 * curation uses, whose rarity test is the scorer's own (`isRare`) at the
 * candidate rare line.
 */
function measureAt(answers: readonly SittingAnswer[], lines: Lines, scoring: ScoringConfig): PuzzleFacts {
  const kept = answers
    .filter((a) => tierAt(a.knownness, lines) === "answer")
    .map((a) => ({ length: a.length, knownness: valueAt(a.knownness!, lines) }));
  return measureAnswers(kept, scoringAt(lines, scoring));
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};

/**
 * What the Schedule would look like with the lines moved, without moving them:
 * every scheduled day re-tiered at `lines`, and the faults the repair has to
 * deal with listed.
 */
export function consequencesAt(
  lines: Lines,
  context: ConsequenceContext,
  opts: ConsequenceOptions = DEFAULT_CONSEQUENCE_OPTIONS,
): Consequences {
  const days: DayAtLines[] = context.days.map((d) => {
    const facts = measureAt(d.answers, lines, opts.scoring);
    return {
      date: d.date,
      week: d.week,
      seedWord: d.seedWord,
      rhymeKey: d.rhymeKey,
      seedKnownness: d.seedKnownness,
      answerCount: facts.answerCount,
      difficulty: facts.difficulty,
    };
  });

  const toBonus = new Map<string, AnswerToBonus>();
  for (const d of context.days) {
    for (const a of d.answers) {
      if (a.knownness === null || toBonus.has(a.word)) continue;
      if (tierAt(a.knownness, lines) === "bonus") toBonus.set(a.word, { word: a.word, knownness: a.knownness });
    }
  }

  const byWeek = new Map<number, DayAtLines[]>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const week = byWeek.get(d.week) ?? [];
    week.push(d);
    byWeek.set(d.week, week);
  }
  const weeksOutOfRamp = [...byWeek]
    .filter(([, week]) => week.some((d, i) => i > 0 && d.difficulty < week[i - 1]!.difficulty))
    .map(([week]) => week)
    .sort((a, b) => a - b);

  const daysToReplace = days.filter((d) => d.answerCount < REPLACE_DAY_UNDER);
  const pool = context.pool
    .filter((p) => tierAt(p.seedKnownness, lines) === "answer")
    .map((p) => ({ seedWord: p.seedWord, facts: measureAt(p.answers, lines, opts.scoring) }))
    .filter((p) => p.facts.answerCount >= opts.replacementMinAnswers);
  const replacements = daysToReplace.map((d) => {
    // The slot's place in the ramp: where its weekday's days sit at the new lines.
    const weekday = weekdayOf(d.date);
    const target = median(days.filter((o) => weekdayOf(o.date) === weekday).map((o) => o.difficulty));
    const candidates = [...pool]
      .sort((a, b) => Math.abs(a.facts.difficulty - target) - Math.abs(b.facts.difficulty - target) || a.seedWord.localeCompare(b.seedWord))
      .slice(0, opts.replacementsPerDay)
      .map((p) => p.seedWord);
    return { date: d.date, seedWord: d.seedWord, candidates };
  });

  return {
    answersToBonus: [...toBonus.values()].sort((a, b) => b.knownness - a.knownness || a.word.localeCompare(b.word)),
    days,
    daysUnderBand: days.filter((d) => d.answerCount < DEFAULT_PLAYABLE_BAND.min),
    daysToReplace,
    seedWordsBelowLine: days.filter((d) => tierAt(d.seedKnownness, lines) !== "answer"),
    difficultyZero: days.filter((d) => d.difficulty === 0),
    weeksOutOfRamp,
    replacements,
  };
}
