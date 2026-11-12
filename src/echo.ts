/**
 * The Echo test (#315, ADR-0008 amended 2026-11-12). An **Echo** is a Daily
 * Puzzle with no native Answer, more than half of whose Answers are derived
 * from words in other scheduled Puzzles: `airs` is an Echo of `air`.
 *
 * It is a matter for the Schedule alone, so it reads Puzzles and never a
 * single Seed Word: `testSeedWord` stays a test of one word on one Rhyme Key.
 * It reports and never acts. Which day keeps its place is a person's call.
 */

import { PREFIX_SPELLINGS, SUFFIX_RULES } from "./affixes.ts";
import type { Derivation } from "./derivation.ts";
import type { RhymeKey } from "./phonology.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";
import type { ScheduleDay } from "./schedule.ts";

/**
 * A scheduled Puzzle as the Echo test reads it. `answers` are the Answers left
 * to find, as `buildPuzzle` gives them: the Seed Word is an Answer, but it is
 * given and not found, so it is not among them (decision 4).
 */
export interface EchoPuzzle {
  date: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  answers: readonly string[];
}

/** What the test asks of the Rhyme Index. `RhymeIndex` is one. */
export interface EchoLexicon {
  derivation: Derivation;
  hasWord(word: string): boolean;
  rhymeKeysOf(word: string): RhymeKey[];
}

/** A day an Echo gives back, and the share of the Echo's Answers derived from its words. */
export interface EchoedDay {
  date: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  share: number;
}

export interface EchoTest {
  echo: boolean;
  /** The Answers derived from nothing, under the Echo test's reading of derived. */
  native: string[];
  /** The share of Answers derived from words in other scheduled Puzzles, each counted once. */
  share: number;
  /** The days those words are in, the largest share first. */
  echoed: EchoedDay[];
}

/** The shortest part a compound is split into: two letters admits `ad`, `it` and the word list's junk. */
const MIN_COMPOUND_PART = 3;

/**
 * The words `word` is derived from, under the Echo test's wide reading of
 * derived (ADR-0008 amended 2026-11-12). Empty for a native word. Derived is
 * what the build's detector reads (an inflection, or a configured prefix on a
 * word or an inflection of one), and also:
 *
 *  - a configured derivational suffix on a word (`essentially`), which ADR-0008's
 *    Amendment of 2026-07-30 already counts and the detector deliberately does
 *    not (#88);
 *  - a compound whose last part is derived (`crossbones`, `shellshocked`), read
 *    as derived from that part's stems. Both parts must be words and the last
 *    must be derived, so `carpet` is never `car` + `pet`.
 *
 * The wider reading is the Echo test's alone; the Shadow Key gate keeps the
 * detector's.
 */
export function derivedFrom(word: string, lex: EchoLexicon): string[] {
  const w = word.toLowerCase();
  const own = directStems(w, lex);
  if (own.length > 0) return own;
  for (let i = MIN_COMPOUND_PART; i <= w.length - MIN_COMPOUND_PART; i++) {
    const head = w.slice(0, i);
    const tail = w.slice(i);
    if (!lex.hasWord(head) || !lex.hasWord(tail)) continue;
    const stems = directStems(tail, lex);
    if (stems.length > 0) return stems;
  }
  return [];
}

/** The stems of `w` as an inflection, a prefixed form or a suffixed form, without splitting a compound. */
function directStems(w: string, lex: EchoLexicon): string[] {
  const stems = new Set<string>();
  const inflectionStems = (form: string) =>
    lex.derivation.lemmaCandidates(form).filter((base) => base !== form && lex.hasWord(base));

  for (const base of inflectionStems(w)) stems.add(base);
  // As `Derivation#isDerived` reads a prefix: on a word, or on an inflection of one.
  for (const prefix of PREFIX_SPELLINGS) {
    if (!w.startsWith(prefix)) continue;
    const base = w.slice(prefix.length);
    if (base.length < 2) continue;
    if (lex.hasWord(base)) stems.add(base);
    else for (const lemma of inflectionStems(base)) stems.add(lemma);
  }
  for (const rule of SUFFIX_RULES) {
    for (const stem of rule.stemsOf(w)) if (lex.hasWord(stem)) stems.add(stem);
  }
  return [...stems];
}

/** A Puzzle as the words it holds, the Seed Word with its Answers, as the one-place check compares them. */
const puzzleWords = (p: EchoPuzzle): string => [p.seedWord, ...p.answers].sort().join(" ");

/** Whether `puzzle` is an Echo of the `others`, which are the other scheduled Puzzles. */
export function testEcho(puzzle: EchoPuzzle, others: readonly EchoPuzzle[], lex: EchoLexicon): EchoTest {
  // Another day on this Rhyme Key, or on another spelling of it, is this
  // Puzzle again: an appending Normalisation can file one family under two key
  // spellings, and the one-place check knows them by their words.
  const own = puzzleWords(puzzle);
  const daysOn = new Map<RhymeKey, EchoPuzzle[]>();
  for (const other of others) {
    if (other.rhymeKey === puzzle.rhymeKey || puzzleWords(other) === own) continue;
    daysOn.set(other.rhymeKey, [...(daysOn.get(other.rhymeKey) ?? []), other]);
  }

  const native: string[] = [];
  let restated = 0;
  const supplied = new Map<EchoPuzzle, number>();
  for (const answer of puzzle.answers) {
    const stems = derivedFrom(answer, lex);
    if (stems.length === 0) {
      native.push(answer);
      continue;
    }
    const days = new Set(stems.flatMap((s) => lex.rhymeKeysOf(s)).flatMap((k) => daysOn.get(k) ?? []));
    if (days.size === 0) continue;
    restated++;
    for (const day of days) supplied.set(day, (supplied.get(day) ?? 0) + 1);
  }

  const count = puzzle.answers.length;
  const share = count === 0 ? 0 : restated / count;
  const echoed = [...supplied]
    .map(([day, n]) => ({ date: day.date, seedWord: day.seedWord, rhymeKey: day.rhymeKey, share: n / count }))
    .sort((a, b) => b.share - a.share || a.date.localeCompare(b.date));
  return { echo: native.length === 0 && share > 0.5, native, share, echoed };
}

/** A Puzzle found to be an Echo, with what it echoes. */
export type Echo = EchoPuzzle & EchoTest;

/** Every Echo among `puzzles`, each tested against all the others, in the order given. */
export function echoesIn(puzzles: readonly EchoPuzzle[], lex: EchoLexicon): Echo[] {
  return puzzles
    .map((p) => ({ ...p, ...testEcho(p, puzzles.filter((o) => o !== p), lex) }))
    .filter((t) => t.echo);
}

/**
 * The scheduled days as Puzzles, built off the index. A day that does not pin
 * is no Puzzle and is left out: Continuity reports it.
 */
export function schedulePuzzles(days: readonly ScheduleDay[], index: RhymeIndex): EchoPuzzle[] {
  return days.flatMap(({ date, seed, rhymeKey }) => {
    try {
      const answers = index.buildPuzzle(index.pinSeed(seed, rhymeKey)).answers.map((a) => a.word);
      return [{ date, seedWord: seed, rhymeKey, answers }];
    } catch {
      return [];
    }
  });
}

/**
 * Every Echo among the days holding a place: from `lapStart` on, since a spare
 * in front of the lap played once and never comes round (#265). Without a lap
 * start every day holds one.
 */
export function scheduleEchoes(days: readonly ScheduleDay[], index: RhymeIndex, lapStart?: string): Echo[] {
  const placed = days.filter((d) => lapStart === undefined || d.date >= lapStart);
  return echoesIn(schedulePuzzles(placed, index), index);
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The Echoes as lines for a terminal: a count, then each Echo with its date,
 * Seed Word and share, and the days it echoes. A change passes `joining`, the
 * dates of the days it adds or swaps in, and `before`, the Echoes of the
 * Schedule before it, so the lines say which Echoes are its own doing: a
 * newcomer that echoes, and a day that was no Echo until a newcomer joined.
 */
export function echoLines(
  echoes: readonly Echo[],
  change: { joining: readonly string[]; before: readonly Echo[] } = { joining: [], before: [] },
): string[] {
  if (echoes.length === 0) return ["Echoes: no scheduled day echoes another."];
  const joins = new Set(change.joining);
  // Known by its Seed Word and Rhyme Key, since growing the Schedule moves the
  // rest of the lap to later dates.
  const pair = (e: Echo) => `${e.seedWord}|${e.rhymeKey}`;
  const already = new Set(change.before.map(pair));
  const lines = [
    `Echoes: ${echoes.length} scheduled day(s) have no native Answer and give back more than half their Answers from other days.`,
  ];
  for (const e of echoes) {
    const from = e.echoed.map((d) => `${d.seedWord} ${d.date} ${percent(d.share)}`).join(", ");
    const why = joins.has(e.date)
      ? " (joining)"
      : !already.has(pair(e)) && e.echoed.some((d) => joins.has(d.date))
        ? " (made an Echo by a day joining)"
        : "";
    lines.push(`  ${e.date} ${e.seedWord} on ${e.rhymeKey}: ${percent(e.share)} restated, from ${from}${why}`);
  }
  return lines;
}
