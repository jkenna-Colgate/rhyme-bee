/**
 * One run of the Tier moves from Session Records (#270, ADR-0015 amended), with
 * none of the file IO: the records and the files' text in, the rows to append
 * and the run report out. `scripts/tier-moves.ts` is the command around it.
 *
 * The rules are `src/tierMoves.ts`'s and the precedence is `tierOverride.ts`'s.
 * This is where a replayed Session becomes the evidence those rules read.
 */

import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { DEFAULT_RANK_LADDER } from "../src/scoring.ts";
import type { SessionRecord } from "../src/sessionRecord.ts";
import { replaySessionRecord } from "../src/sessionRecordReplay.ts";
import {
  daysUnderFloor,
  decideMoves,
  parseTierMoves,
  poolFinds,
  serialiseTierMove,
  TIER_MOVE_SETTINGS,
  type DaySession,
  type PlayedSession,
  type StandingEditorVerdict,
} from "../src/tierMoves.ts";
import { parseTierOverrides, resolveTierOverrides } from "../src/tierOverride.ts";

/** The rung the Playability Bar's Reachability part names. */
const REACHABILITY_RUNG = "Laureate";

export interface TierMovesRunInput {
  records: readonly SessionRecord[];
  /** Opened only when there is a record to replay. */
  openIndex: () => RhymeIndex;
  /** The pinned prevalence norms, unpatched: the guard asks for the word's own row. */
  measured: ReadonlyMap<string, number>;
  /** The names data. */
  names: ReadonlySet<string>;
  /** `data/tier-overrides.csv` as text. */
  overrides: string;
  /** `data/tier-moves.csv` as text. */
  moves: string;
  /** When the run happened, as the moves file records it. */
  now: string;
  settings?: {
    share: number;
    reachabilityFloor: number;
    fewestSessionsPerDay: number;
  };
}

export interface TierMovesRun {
  /** The rows to append to `data/tier-moves.csv`; empty when nothing moved. */
  rows: string;
  /** The run report, a line at a time. */
  report: string[];
}

export function runTierMoves(input: TierMovesRunInput): TierMovesRun {
  const settings = input.settings ?? TIER_MOVE_SETTINGS;
  const laureate = DEFAULT_RANK_LADDER.find((rung) => rung.label === REACHABILITY_RUNG);
  if (laureate === undefined) throw new Error(`The Rank ladder has no ${REACHABILITY_RUNG} rung.`);

  const played: PlayedSession[] = [];
  const days: DaySession[] = [];
  const bonusWords = new Set<string>();
  const unreplayed: string[] = [];

  const index = input.records.length > 0 ? input.openIndex() : null;
  for (const record of input.records) {
    const replay = replaySessionRecord(index!, record);
    if (!replay.replayed) {
      unreplayed.push(`${record.date} ${record.seed.word} (${record.seed.rhymeKey}): ${replay.problem}`);
      continue;
    }
    for (const word of replay.held.bonusWords) bonusWords.add(word);
    played.push({
      id: record.id,
      held: [...replay.held.answers, ...replay.held.bonusWords],
      found: [...replay.found.answers, ...replay.found.bonus],
    });
    days.push({
      id: record.id,
      date: record.date,
      reachedLaureate: replay.rank.threshold >= laureate.threshold,
    });
  }

  const standing = new Map<string, StandingEditorVerdict>();
  for (const [word, row] of resolveTierOverrides(parseTierOverrides(input.overrides))) {
    standing.set(word, { verdict: row.verdict, locked: row.locked === true });
  }

  const decided = decideMoves({
    pooled: poolFinds(played),
    share: settings.share,
    isBonusWord: (word) => bonusWords.has(word),
    hasPrevalence: (word) => input.measured.has(word),
    isName: (word) => input.names.has(word),
    standing,
    moved: parseTierMoves(input.moves),
  });
  const under = daysUnderFloor(days, {
    floor: settings.reachabilityFloor,
    fewestSessions: settings.fewestSessionsPerDay,
  });

  const evidence = (m: { finds: number; sessions: number; lowerBound: number }) =>
    `${m.finds} of ${m.sessions} Sessions, lower bound ${m.lowerBound.toFixed(3)}`;
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

  const report = [
    `Session Records: ${input.records.length} read, ${played.length} replayed` +
      `${unreplayed.length > 0 ? `, ${unreplayed.length} could not be` : ""}.`,
    ...unreplayed.map((line) => `  cannot replay ${line}`),
    `Settings (unclaimed placeholders): share ${settings.share}, Reachability floor ` +
      `${settings.reachabilityFloor}, fewest Sessions a day ${settings.fewestSessionsPerDay}.`,
    decided.moves.length === 0 ? "Moved nothing to Answer." : `Moved to Answer: ${decided.moves.length}.`,
    ...decided.moves.map((m) => `  ${m.word}: ${evidence(m)}`),
    ...(decided.overridden.length === 0
      ? []
      : [
          `Editor's verdicts a move overrides: ${decided.overridden.length}.`,
          ...decided.overridden.map((o) => `  ${o.word}: ${o.verdict}, unlocked`),
        ]),
    ...(decided.heldBack.length === 0
      ? []
      : [
          `Held back: ${decided.heldBack.length}.`,
          ...decided.heldBack.map((h) => `  ${h.word}: ${HELD_BACK[h.reason]} (${evidence(h)})`),
        ]),
    under.length === 0
      ? `No day under the Reachability floor.`
      : `Days under the Reachability floor: ${under.length}. Reported, never acted on.`,
    ...under.map(
      (d) => `  ${d.date}: ${d.reached} of ${d.sessions} Sessions reached ${REACHABILITY_RUNG} (${percent(d.share)})`,
    ),
  ];

  return {
    rows: decided.moves.map((m) => serialiseTierMove(m, input.now)).join(""),
    report,
  };
}

const HELD_BACK = {
  name: "in the names data",
  "no-prevalence": "no prevalence row",
  locked: "the editor's verdict is locked",
} as const;
