/**
 * The pure parts of the monthly workflow (#274, ADR-0021 amended 2026-10-26):
 * which Appeals go to the Judge this run, and the run report the workflow
 * commits. The commands around them are `scripts/judge-appeals.ts` and
 * `scripts/monthly-report.ts`; `.github/workflows/monthly.yml` only puts the
 * commands in order.
 */

import { normaliseWord } from "../src/cmudict.ts";
import type { Decline } from "../src/declines.ts";
import type { JudgeQuestion } from "../src/judge.ts";
import { planJudging, type JudgeRulingRecord } from "../src/judgeLanding.ts";
import type { RhymeKey } from "../src/phonology.ts";
import type { SupplementCandidate } from "../src/supplementCandidate.ts";

/**
 * Where the steps leave their parts of the run report for `monthly:report`.
 * Under `data/`, so gitignored, and emptied by the report that reads it.
 */
export const MONTHLY_RUN_DIR = "data/monthly-run";

/** The run report's stem in `data/judge-runs/`, which also numbers the run. */
export const MONTHLY_STEM = (model: string) => `monthly.${model}`;

/** One Appealed pair, as the Judge's leg takes it. */
export interface AppealItem {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  question: JudgeQuestion;
  /** When the earliest Appeal of this pair was raised. */
  timestamp: string;
}

export interface AppealsContext {
  /** Whether the Judge is asked about a word on a Rhyme Key, and as what: `judgeQuestion` on the index. */
  question: (word: string, rhymeKey: RhymeKey) => JudgeQuestion;
  /** The Rhyme Keys a Seed Word reads on in the index now. */
  seedKeys: (seedWord: string) => readonly RhymeKey[];
  /** `data/judge-rulings.jsonl`: every pair already ruled on. */
  rulings: readonly JudgeRulingRecord[];
  /** `data/declines.txt`: every pair the editor has Declined. */
  declines: readonly Decline[];
  /** The most Candidates this run sends to the Judge. */
  limit: number;
}

export interface AppealsPlan {
  /** Sent to the Judge this run, oldest Appeal first, no more than the limit. */
  send: AppealItem[];
  /** Would be sent but for the limit: the next run's, first in line. */
  waiting: AppealItem[];
  /** Not sent, and costing nothing: the index already settles them, or the word list has no word to rule on. */
  setAside: AppealItem[];
  ruledBefore: { item: AppealItem; record: JudgeRulingRecord }[];
  declined: AppealItem[];
  /** Appeals whose Seed Word no longer reads on the Rhyme Key they were raised on, so no ruling could land on it. */
  keyGone: SupplementCandidate[];
}

/**
 * Which Appeals the Judge rules on this run. A pair is sent once: one already
 * ruled on or Declined is never sent, two Appeals of one pair are one
 * Candidate, and a pair the limit holds back is not recorded, so it is first in
 * line next run.
 */
export function planAppeals(queue: readonly SupplementCandidate[], ctx: AppealsContext): AppealsPlan {
  const ordered = [...queue].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  const keyGone: SupplementCandidate[] = [];
  const items: AppealItem[] = [];
  for (const c of ordered) {
    const rhymeKey = c.seedRhymeKey as RhymeKey;
    if (!ctx.seedKeys(c.seedWord).includes(rhymeKey)) {
      keyGone.push(c);
      continue;
    }
    const word = normaliseWord(c.word);
    items.push({ word, seedWord: c.seedWord, rhymeKey, question: ctx.question(word, rhymeKey), timestamp: c.timestamp });
  }

  const { send, ruledBefore, declined } = planJudging(items, ctx.rulings, ctx.declines);
  const asked = send.filter((i) => "ask" in i.question);
  return {
    send: asked.slice(0, ctx.limit),
    waiting: asked.slice(ctx.limit),
    setAside: send.filter((i) => "setAside" in i.question),
    ruledBefore: ruledBefore.map(({ candidate, record }) => ({ item: candidate, record })),
    declined,
    keyGone,
  };
}

// ---- the run report --------------------------------------------------------------

/** A pair as the report names it. */
export interface NamedPair {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
}

/**
 * What the Appeals step leaves for the report: `scripts/judge-appeals.ts`
 * writes it to `data/monthly-run/appeals.json` once its writes have landed. Its
 * first fields are the ones every run report in `data/judge-runs/` carries (#250).
 */
export interface AppealsPart {
  date: string;
  model: string;
  run: number;
  limit: number;
  answeredBy: string[];
  calls: { rhyme: number; wordhood: number; fromCache: number };
  candidatesJudged: number;
  landed: Record<string, number>;
  writes: {
    readings: { word: string; reading: string }[];
    unconfirmedRhymes: unknown[];
    suggestedDemotions: unknown[];
  };
  rulings: unknown[];
  waiting: NamedPair[];
  setAside: (NamedPair & { why: string })[];
  ruledBefore: (NamedPair & { ruledOn: string; landed: string })[];
  declined: NamedPair[];
  keyGone: NamedPair[];
}

/**
 * The Continuity lines in a build's output (#256): the line that opens with
 * `Continuity:` and the indented lines under it.
 */
export function continuityLinesIn(buildLog: string): string[] {
  const lines = buildLog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("Continuity:"));
  if (start === -1) return [];
  const out = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    out.push(line);
  }
  return out;
}

export interface MonthlyReportInput {
  date: string;
  run: number;
  /** The pinned model, said even when the Appeals step never reached it. */
  model: string;
  /** The Appeals step's outcome as GitHub gives it (`success`, `failure`), or `by-hand`. */
  appealsStep: string;
  /** What the Appeals step left, or null when it left nothing. */
  appeals: AppealsPart | null;
  /** The output of `npm run tier:moves`: every line is a report line. */
  tierMovesLog: string;
  /** The output of the build that ran after the writes. */
  buildLog: string;
}

/** GitHub's step outcomes, as a sentence says them. */
const STEP_ENDED: Record<string, string> = { failure: "failed", cancelled: "was cancelled", skipped: "did not run", success: "succeeded" };

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The monthly run's report, in the run report format of `data/judge-runs/`, and the subject of the commit that carries it. */
export function monthlyReport(input: MonthlyReportInput): { report: Record<string, unknown>; subject: string } {
  const a = input.appeals;
  const tierMoves = input.tierMovesLog.trimEnd().split(/\r?\n/).filter((l) => l !== "");
  const continuity = continuityLinesIn(input.buildLog);
  const moved = Number(tierMoves.map((l) => /^Moved to Answer: (\d+)\./.exec(l)?.[1]).find(Boolean) ?? 0);
  const repaired = continuity.filter((l) => l.startsWith("  repaired ")).length;
  const stepEnded = STEP_ENDED[input.appealsStep] ?? `ended ${input.appealsStep}`;

  const report = {
    date: input.date,
    command: "monthly",
    run: input.run,
    model: input.model,
    answeredBy: a?.answeredBy ?? [],
    calls: a?.calls ?? { rhyme: 0, wordhood: 0, fromCache: 0 },
    candidatesJudged: a?.candidatesJudged ?? 0,
    landed: a?.landed ?? {},
    writes: a?.writes ?? { readings: [], unconfirmedRhymes: [], suggestedDemotions: [] },
    note: a
      ? "Every write is listed under writes, and every ruling is recorded in data/judge-rulings.jsonl. Appeals over the limit wait for the next run (#274)."
      : `The Appeals step ${stepEnded} and left no record, so nothing was judged and nothing was written for it. The Tier moves and the Continuity check ran without it (#274).`,
    appeals: a
      ? { step: input.appealsStep, limit: a.limit, waiting: a.waiting, setAside: a.setAside, ruledBefore: a.ruledBefore, declined: a.declined, keyGone: a.keyGone }
      : { step: input.appealsStep },
    rulings: a?.rulings ?? [],
    tierMoves,
    continuity,
  };

  const judged = a ? `${count(a.candidatesJudged, "Appeal")} judged` : `the Appeals step ${stepEnded}`;
  return { report, subject: `Monthly run ${input.date}: ${judged}, ${count(moved, "Tier move")}, ${count(repaired, "day")} repaired` };
}
