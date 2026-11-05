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
import { standingVerdict, type LabelSet } from "./judgeLabels.ts";
import { weekdayOf, type PuzzleFacts } from "./schedule.ts";
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from "./scoring.ts";
import { verdictForValue } from "./tierOverride.ts";
import type { Tier } from "./verdict.ts";

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
export type Mark = "easy" | "hard-find" | "bonus";

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

/** A single cut on one signal: a word below it is called B, and the share of marks that call agrees with. */
export interface SignalCut {
  cut: number;
  agreement: number;
}

export interface SignalComparison {
  knownness: SignalCut;
  frequency: SignalCut;
  /** Knownness as a minimum, with frequency deciding above it: B when below either. */
  combined: { knownnessMinimum: number; frequencyCut: number; agreement: number };
}

/**
 * Every cut worth trying on a signal: each distinct value (a cut at a value
 * calls B everything strictly below it, so the lowest calls nothing B), and
 * one above them all, which calls everything B.
 */
function cutsOf(values: readonly number[]): number[] {
  const distinct = [...new Set(values.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  return [...distinct, Infinity];
}

/**
 * How well each signal, on its own and together, separates the B marks from
 * the E and H marks: the best single cut for each, and the share of marks it
 * agrees with. Of equally good cuts the lowest is reported. A word with no
 * frequency sits below every frequency cut.
 */
export function compareSignals(marks: readonly MarkedWord[]): SignalComparison {
  const isB = marks.map((m) => m.mark === "bonus");
  const k = marks.map((m) => m.knownness);
  const f = marks.map((m) => m.frequency ?? -Infinity);
  const agreement = (calledB: (i: number) => boolean) => {
    let agreed = 0;
    for (let i = 0; i < marks.length; i++) if (calledB(i) === isB[i]) agreed++;
    return marks.length === 0 ? 0 : agreed / marks.length;
  };
  const best = (values: number[]): SignalCut => {
    let out: SignalCut = { cut: -Infinity, agreement: -1 };
    for (const cut of cutsOf(values)) {
      const a = agreement((i) => values[i]! < cut);
      if (a > out.agreement) out = { cut, agreement: a };
    }
    return out;
  };
  let combined = { knownnessMinimum: -Infinity, frequencyCut: -Infinity, agreement: -1 };
  for (const knownnessMinimum of cutsOf(k)) {
    for (const frequencyCut of cutsOf(f)) {
      const a = agreement((i) => k[i]! < knownnessMinimum || f[i]! < frequencyCut);
      if (a > combined.agreement) combined = { knownnessMinimum, frequencyCut, agreement: a };
    }
  }
  return { knownness: best(k), frequency: best(f), combined };
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
  /** The unscheduled Seed pool, where a day under 10 Answers looks for a replacement. */
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

export interface TierChange {
  word: string;
  knownness: number;
  from: Tier;
  to: Tier;
}

export interface Consequences {
  /** Every scheduled Answer whose Tier the lines change, once per word. */
  tierChanges: TierChange[];
  days: DayAtLines[];
  daysUnder20: DayAtLines[];
  daysUnder10: DayAtLines[];
  seedWordsBelowLine: DayAtLines[];
  difficultyZero: DayAtLines[];
  /** The weeks, of more than one day, whose Difficulty no longer rises Monday to Sunday. */
  weeksOutOfRamp: number[];
  replacements: { date: string; seedWord: string; candidates: string[] }[];
}

export interface ConsequenceOptions {
  scoring: ScoringConfig;
  /** How many replacement Seed Words to offer for each day under 10. */
  replacementsPerDay: number;
  /** A replacement must hold at least this many Answers at the lines: the size band's floor. */
  replacementMinAnswers: number;
}

export const DEFAULT_CONSEQUENCE_OPTIONS: ConsequenceOptions = {
  scoring: DEFAULT_SCORING_CONFIG,
  replacementsPerDay: 5,
  replacementMinAnswers: DEFAULT_PLAYABLE_BAND.min,
};

/**
 * A word's Tier and rarity at a pair of lines. A verdict holds its Tier at any
 * lines, an `answer-rare` verdict staying rare: its sentinel moves with the
 * lines (#307), so it says nothing about where they sit.
 */
function standingAt(knownness: number | null, lines: Lines): { tier: Tier; rare: boolean } {
  if (knownness === null) return { tier: "bonus", rare: false };
  const verdict = verdictForValue(knownness);
  if (verdict === "bonus") return { tier: "bonus", rare: false };
  if (verdict === "answer-common") return { tier: "answer", rare: false };
  if (verdict === "answer-rare") return { tier: "answer", rare: true };
  return knownness >= lines.answerLine ? { tier: "answer", rare: knownness < lines.rareLine } : { tier: "bonus", rare: false };
}

/** A family's Answers at the lines, measured by the one Difficulty definition curation uses. */
function measureAt(answers: readonly SittingAnswer[], lines: Lines, scoring: ScoringConfig): PuzzleFacts {
  const kept = answers
    .map((a) => ({ a, at: standingAt(a.knownness, lines) }))
    .filter(({ at }) => at.tier === "answer")
    // Rarity is settled above, so it is handed to the measurer as a knownness either side of the rare line.
    .map(({ a, at }) => ({ length: a.length, knownness: at.rare ? -Infinity : Infinity }));
  return measureAnswers(kept, scoring);
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

  const changed = new Map<string, TierChange>();
  for (const d of context.days) {
    for (const a of d.answers) {
      if (a.knownness === null || changed.has(a.word)) continue;
      const to = standingAt(a.knownness, lines).tier;
      if (to !== "answer") changed.set(a.word, { word: a.word, knownness: a.knownness, from: "answer", to });
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

  const daysUnder10 = days.filter((d) => d.answerCount < 10);
  const pool = context.pool
    .filter((p) => standingAt(p.seedKnownness, lines).tier === "answer")
    .map((p) => ({ seedWord: p.seedWord, facts: measureAt(p.answers, lines, opts.scoring) }))
    .filter((p) => p.facts.answerCount >= opts.replacementMinAnswers);
  const replacements = daysUnder10.map((d) => {
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
    tierChanges: [...changed.values()].sort((a, b) => b.knownness - a.knownness || a.word.localeCompare(b.word)),
    days,
    daysUnder20: days.filter((d) => d.answerCount < 20),
    daysUnder10,
    seedWordsBelowLine: days.filter((d) => standingAt(d.seedKnownness, lines).tier !== "answer"),
    difficultyZero: days.filter((d) => d.difficulty === 0),
    weeksOutOfRamp,
    replacements,
  };
}
