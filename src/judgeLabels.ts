/**
 * Label sets, and the Judge's score against them (#250).
 *
 * A label set is the maintainer's verdicts on pairs, committed like the
 * Demotions, one file per set in `data/judge-labels/` so a set is swapped or
 * added by adding a file. Its header says who labelled it, when, whether blind,
 * and under which rules. Every verdict names its labeller, so one set can hold
 * several people's verdicts on one pair, and every figure here is stated per
 * labeller: whose ear wins when people disagree is not decided.
 *
 * Only a person's verdicts are stored. The pairs the rules decide on their own
 * are labelled at scoring time from the rules as they stand (`judgeRules.ts`), so
 * those labels never go stale when a Normalisation lands. A verdict changed after
 * seeing the Judge's ruling is kept and marked non-blind, and the blind figure is
 * the default.
 */

import { classifyRuling, readingReachesKey, type Confidence, type JudgeQuestion, type RhymeRuling, type WordhoodRuling } from "./judge.ts";
import type { RuleDecision } from "./judgeRules.ts";
import type { RhymeKey } from "./phonology.ts";

// ---- the file ------------------------------------------------------------------

export type Question = "rhyme" | "wordhood";

/** The verdicts a person may give, by the question the set asks. `out` is a pair shown and left unruled. */
const VERDICTS: Record<Question, ReadonlySet<string>> = {
  rhyme: new Set(["rhyme", "no-rhyme", "out"]),
  wordhood: new Set(["word", "not-a-word"]),
};

export interface LabelVerdict {
  labeller: string;
  verdict: string;
  /** The date it was given. */
  on: string;
  /** False for a verdict given after seeing the Judge's ruling. */
  blind: boolean;
  /** True for a verdict a later blind verdict by the same labeller replaced. */
  superseded?: boolean;
  note?: string;
}

export interface LabelledPair {
  word: string;
  seedWord: string;
  /** The reading the Seed Word was pinned to when the pair was cut. Its Rhyme Key is worked out again at scoring time. */
  seedReading: string | null;
  rhymeKeyWhenCut: RhymeKey;
  /** Wiktionary's US transcriptions of the word, which the rules read as a second dictionary. */
  wiktionary: string[];
  verdicts: LabelVerdict[];
}

export interface LabelSet {
  set: string;
  question: Question;
  labelledBy: string[];
  labelledOn: string;
  blind: boolean;
  /** The tickets whose rules the verdicts follow. */
  rules: string[];
  /** A set the Judge was tuned on: a score on it flatters the Judge. */
  tuning: boolean;
  notes: string[];
  pairs: LabelledPair[];
}

function need<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new Error(`label set: ${what}`);
  return value;
}
const str = (o: Record<string, unknown>, k: string, where: string): string => need(typeof o[k] === "string" && o[k] !== "", o[k] as string, `${where} needs a ${k}`);
const strs = (o: Record<string, unknown>, k: string, where: string): string[] =>
  need(Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string"), o[k] as string[], `${where} needs ${k} as a list of strings`);
const bool = (o: Record<string, unknown>, k: string, where: string): boolean => need(typeof o[k] === "boolean", o[k] as boolean, `${where} needs ${k} as true or false`);
const obj = (x: unknown, where: string): Record<string, unknown> => need(!!x && typeof x === "object" && !Array.isArray(x), x as Record<string, unknown>, `${where} is not an object`);

/** Read a label set, refusing one whose verdicts cannot be attributed or do not answer its question. */
export function parseLabelSet(json: unknown): LabelSet {
  const o = obj(json, "the file");
  const question = str(o, "question", "the header");
  if (question !== "rhyme" && question !== "wordhood") throw new Error(`label set: the question is rhyme or wordhood, not ${question}`);
  const pairs = need(Array.isArray(o.pairs), o.pairs as unknown[], "needs pairs").map((x, i): LabelledPair => {
    const p = obj(x, `pair ${i}`);
    const where = `pair ${i} (${String(p.word)})`;
    const verdicts = need(Array.isArray(p.verdicts), p.verdicts as unknown[], `${where} needs verdicts`).map((y, j): LabelVerdict => {
      const q = obj(y, `${where} verdict ${j}`);
      const at = `${where} verdict ${j}`;
      const verdict = str(q, "verdict", at);
      if (!VERDICTS[question].has(verdict)) throw new Error(`label set: ${at} is ${verdict}, which a ${question} set does not have`);
      return {
        labeller: str(q, "labeller", at),
        verdict,
        on: str(q, "on", at),
        blind: bool(q, "blind", at),
        ...(q.superseded === true ? { superseded: true } : {}),
        ...(typeof q.note === "string" ? { note: q.note } : {}),
      };
    });
    return {
      word: str(p, "word", where),
      seedWord: str(p, "seedWord", where),
      seedReading: typeof p.seedReading === "string" ? p.seedReading : null,
      rhymeKeyWhenCut: str(p, "rhymeKeyWhenCut", where),
      wiktionary: p.wiktionary === undefined ? [] : strs(p, "wiktionary", where),
      verdicts,
    };
  });
  return {
    set: str(o, "set", "the header"),
    question,
    labelledBy: strs(o, "labelledBy", "the header"),
    labelledOn: str(o, "labelledOn", "the header"),
    blind: bool(o, "blind", "the header"),
    rules: strs(o, "rules", "the header"),
    tuning: bool(o, "tuning", "the header"),
    notes: strs(o, "notes", "the header"),
    pairs,
  };
}

/** Everyone who gave a verdict in the set, in the order they first appear. */
export function labellersOf(set: LabelSet): string[] {
  return [...new Set(set.pairs.flatMap((p) => p.verdicts.map((v) => v.labeller)))];
}

export interface ScoringOptions {
  /** Count only verdicts given blind. The default, and the figure the margin is stated in. */
  blindOnly: boolean;
}

/**
 * A labeller's verdict on a pair as it stands: the latest one nothing has
 * superseded, and, by default, only a blind one. The file lists verdicts in the
 * order they were given.
 */
export function standingVerdict(pair: { verdicts: readonly LabelVerdict[] }, labeller: string, opts: ScoringOptions): LabelVerdict | null {
  const standing = pair.verdicts.filter((v) => v.labeller === labeller && !v.superseded && (v.blind || !opts.blindOnly));
  return standing[standing.length - 1] ?? null;
}

// ---- the score on a rhyme set ----------------------------------------------------

/** One labelled pair with everything worked out for it at scoring time. */
export interface RuledPair {
  word: string;
  seedWord: string;
  /** The Seed Word's Rhyme Key as the index reads it now. */
  rhymeKey: RhymeKey;
  /** What the game knows about the word now. */
  question: JudgeQuestion;
  /** What the rules make of the pair now. */
  rule: RuleDecision;
  ruling: RhymeRuling;
  verdicts: readonly LabelVerdict[];
}

export interface Tally {
  scored: number;
  agreed: number;
}

export interface Miss {
  word: string;
  seedWord: string;
  label: "rhyme" | "no-rhyme";
  from: "labeller" | "rules";
  ruling: RhymeRuling;
  reachesKey: boolean;
}

export interface RhymeScore extends Tally {
  labeller: string;
  /** Agreement counting any "rhyme" as a Rhyme, gate or no gate. */
  ungated: Tally;
  fromLabeller: Tally;
  fromRules: Tally;
  /** By what the game knows about the word: `missing-reading`, `overrule`, or why it would not be sent. */
  byCase: Record<string, Tally>;
  byConfidence: Partial<Record<Confidence, Tally>>;
  /** `label -> ruling` counts, the ruling read through the gate. */
  confusion: Record<string, number>;
  misses: Miss[];
  /** Of the scored pairs, those whose ruling would act, and how many of them are labelled no Rhyme. */
  wouldLand: Partial<Record<"reading" | "unconfirmed-rhyme", { written: number; wrong: number }>>;
}

const bump = (t: Record<string, Tally>, k: string, agreed: boolean) => {
  const x = (t[k] ??= { scored: 0, agreed: 0 });
  x.scored++;
  if (agreed) x.agreed++;
};

/**
 * The Judge's agreement with one labeller. A pair's label is the labeller's
 * standing verdict on it; where they gave none, the rules' Rhyme or no Rhyme.
 * A pair the labeller was shown and left out (`out`) is not scored, whatever
 * the rules say, and nor is one the rules put to a person or keep out. A ruling
 * of Rhyme counts only when its reading reaches the key.
 */
export function scoreRhymes(pairs: readonly RuledPair[], labeller: string, opts: ScoringOptions): RhymeScore {
  const score: RhymeScore = {
    labeller, scored: 0, agreed: 0, ungated: { scored: 0, agreed: 0 }, fromLabeller: { scored: 0, agreed: 0 },
    fromRules: { scored: 0, agreed: 0 }, byCase: {}, byConfidence: {}, confusion: {}, misses: [], wouldLand: {},
  };
  for (const p of pairs) {
    const mine = standingVerdict(p, labeller, opts);
    const label = mine ? mine.verdict : p.rule.verdict;
    if (label !== "rhyme" && label !== "no-rhyme") continue;
    const from = mine ? "labeller" : "rules";
    const reachesKey = p.ruling.verdict === "rhyme" && readingReachesKey(p.ruling.reading, p.rhymeKey);
    const judged = reachesKey ? "rhyme" : "no-rhyme";
    const agreed = judged === label;

    score.scored++;
    if (agreed) score.agreed++;
    score.ungated.scored++;
    if ((p.ruling.verdict === "rhyme" ? "rhyme" : "no-rhyme") === label) score.ungated.agreed++;
    const source = from === "labeller" ? score.fromLabeller : score.fromRules;
    source.scored++;
    if (agreed) source.agreed++;
    bump(score.byCase, "ask" in p.question ? p.question.ask : p.question.setAside, agreed);
    bump(score.byConfidence as Record<string, Tally>, p.ruling.confidence, agreed);
    score.confusion[`${label} -> ${judged}`] = (score.confusion[`${label} -> ${judged}`] ?? 0) + 1;
    if (!agreed) score.misses.push({ word: p.word, seedWord: p.seedWord, label, from, ruling: p.ruling, reachesKey });

    if ("ask" in p.question) {
      const lands = classifyRuling(p.question.ask, p.ruling, p.rhymeKey).lands;
      if (lands === "reading" || lands === "unconfirmed-rhyme") {
        const w = (score.wouldLand[lands] ??= { written: 0, wrong: 0 });
        w.written++;
        if (label === "no-rhyme") w.wrong++;
      }
    }
  }
  return score;
}

// ---- the score on a wordhood set ----------------------------------------------------

export interface WordhoodScore {
  labeller: string;
  /** Names and non-words held back (any ruling but "word"). */
  caught: Tally;
  /** Words left alone. */
  leftAlone: Tally;
  misses: { word: string; label: string; ruling: WordhoodRuling }[];
}

/** The wordhood question's agreement with one labeller: a name or a non-word should be held back, a word left alone. */
export function scoreWordhood(
  pairs: readonly { word: string; verdicts: readonly LabelVerdict[] }[],
  rulings: readonly WordhoodRuling[],
  labeller: string,
  opts: ScoringOptions,
): WordhoodScore {
  const byWord = new Map(rulings.map((r) => [r.word, r]));
  const score: WordhoodScore = { labeller, caught: { scored: 0, agreed: 0 }, leftAlone: { scored: 0, agreed: 0 }, misses: [] };
  for (const p of pairs) {
    const label = standingVerdict(p, labeller, opts)?.verdict;
    const ruling = byWord.get(p.word);
    if (!label || !ruling) continue;
    const held = ruling.verdict !== "word";
    const t = label === "not-a-word" ? score.caught : score.leftAlone;
    const agreed = held === (label === "not-a-word");
    t.scored++;
    if (agreed) t.agreed++;
    else score.misses.push({ word: p.word, label, ruling });
  }
  return score;
}
