/**
 * The Tier move from Session Records (#270, ADR-0015 amended): a Bonus Word that
 * enough players produce becomes an Answer, with nobody ruling on it.
 *
 * Session Records are the one direct measure of Retrieval, and they read in one
 * direction only. A word a player found is a word that player produced; a word
 * a Session never found may only mean the Session stopped early. So this module
 * moves words to Answer and never the other way.
 *
 * It is pure. The command that reads the records, replays them and writes
 * `data/tier-moves.csv` is `scripts/tier-moves.ts`; the precedence the build
 * merges that file under is `tierOverride.ts`'s, so no adjudication code learns
 * that moves exist.
 */

import type { TierVerdict } from "./tierOverride.ts";

/** The confidence a move needs that more than `share` of players find the word (claimed: 95%). */
export const MOVE_CONFIDENCE = 0.95;

/**
 * The settings #242 and #251 decided exist and claimed no value for. Each is a
 * **placeholder, unclaimed**: a number had to be written for the command to run,
 * and none of these has been tuned against real play or ruled on by the
 * maintainer. Change them here; nothing else holds a copy.
 */
export const TIER_MOVE_SETTINGS = {
  /**
   * UNCLAIMED. The find share a move must be 95% confident is exceeded. 0.2: a
   * Bonus Word one player in five produces unprompted is retrieved as well as
   * many Answers are. Under the exact bound it takes 2 finds in 2 Sessions, or
   * 7 in 15, to clear.
   */
  share: 0.2,
  /** UNCLAIMED. The share of a day's Sessions that should reach Laureate. */
  reachabilityFloor: 0.1,
  /** UNCLAIMED. The fewest Sessions a day needs before its share is reported against the floor. */
  fewestSessionsPerDay: 20,
} as const;

/**
 * The one-sided lower confidence bound on a find share, `finds` of `sessions`,
 * by the **Clopper-Pearson** (exact binomial) method: the share `p` at which
 * finding the word `finds` or more times in `sessions` would happen with
 * probability `1 - confidence`. Any smaller share makes what was seen rarer than
 * that.
 *
 * Exact rather than the Wilson score bound, because Wilson is generous at the
 * edge this test lives on: one find in one Session gives a Wilson bound of 0.27
 * and an exact bound of 0.05. The exact bound is the reading the issue's own
 * example takes ("0 of 40 only says fewer than 7.5% find a word").
 *
 * Found by bisection on the binomial tail, which is monotone in `p`.
 */
export function findShareLowerBound(
  finds: number,
  sessions: number,
  confidence: number = MOVE_CONFIDENCE,
): number {
  if (finds <= 0 || sessions <= 0) return 0;
  const alpha = 1 - confidence;
  if (finds >= sessions) return Math.pow(alpha, 1 / sessions);

  let low = 0;
  let high = 1;
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (upperTail(finds, sessions, mid) < alpha) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** P(X >= k) for X ~ Binomial(n, p), summed in log space so a large n cannot underflow. */
function upperTail(k: number, n: number, p: number): number {
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  // log C(n, k), built up once, then stepped term to term.
  let logChoose = 0;
  for (let i = 1; i <= k; i++) logChoose += Math.log(n - k + i) - Math.log(i);
  let tail = 0;
  for (let j = k; j <= n; j++) {
    tail += Math.exp(logChoose + j * logP + (n - j) * logQ);
    logChoose += Math.log(n - j) - Math.log(j + 1);
  }
  return tail;
}

/** One replayed Session, as far as the pooling reads it. */
export interface PlayedSession {
  /** The Session Record's id. A resend carries the same one. */
  id: string;
  /** Every word the Session's Puzzle holds: its Answers and its Bonus Words. */
  held: readonly string[];
  /** Every word the Session accepted, Answer or not. */
  found: readonly string[];
}

/** One word's evidence: Sessions that found it, of the Sessions whose Puzzle held it. */
export interface FindCount {
  finds: number;
  sessions: number;
}

/**
 * Each word's finds, **pooled** over every Session on every day the word is in,
 * and so over every lap. A word on two Rhyme Keys (`excuse` on the `booze` and
 * `juice` days) gets one count and so one verdict: acting on each day alone
 * would let one day move it and the other move it back.
 *
 * A find counts whether the word was an Answer or a Bonus Word when it was
 * found. An accepted word the Puzzle does not hold (a Weak Rhyme, an
 * Unconfirmed Rhyme) holds no Tier, so it is no evidence about one.
 *
 * A Session Record is one per Session and a resend overwrites it, so a Session
 * met twice counts once, as its last copy.
 */
export function poolFinds(sessions: readonly PlayedSession[]): Map<string, FindCount> {
  const latest = new Map<string, PlayedSession>();
  for (const session of sessions) latest.set(session.id, session);

  const pooled = new Map<string, FindCount>();
  for (const session of latest.values()) {
    const found = new Set(session.found);
    for (const word of new Set(session.held)) {
      const count = pooled.get(word) ?? { finds: 0, sessions: 0 };
      count.sessions += 1;
      if (found.has(word)) count.finds += 1;
      pooled.set(word, count);
    }
  }
  return pooled;
}

/** The editor's standing Tier verdict on a word, as the moves read it. */
export interface StandingEditorVerdict {
  verdict: TierVerdict;
  /** Set from the Editor's Pass. A locked verdict beats a move. */
  locked: boolean;
}

export interface MoveInput {
  pooled: ReadonlyMap<string, FindCount>;
  /** The find share a move must be confident is exceeded. */
  share: number;
  /** Whether the word is a Bonus Word in the index the Sessions were replayed against. */
  isBonusWord: (word: string) => boolean;
  /** Whether the pinned prevalence data holds a row for the word itself. */
  hasPrevalence: (word: string) => boolean;
  /** Whether the word is in the names data. */
  isName: (word: string) => boolean;
  /** `data/tier-overrides.csv`, resolved to one verdict per word. */
  standing: ReadonlyMap<string, StandingEditorVerdict>;
  /** Every word `data/tier-moves.csv` already moves. */
  moved: ReadonlySet<string>;
}

/** A word moved to Answer, with the evidence that moved it. */
export interface TierMove extends FindCount {
  word: string;
  /** The one-sided lower bound on the find share, which cleared the share. */
  lowerBound: number;
}

/** Why a word that cleared the share does not move. */
export type HeldBackReason = "name" | "no-prevalence" | "locked";

export interface HeldBack extends TierMove {
  reason: HeldBackReason;
}

export interface DecidedMoves {
  /** New moves, to be appended to `data/tier-moves.csv`. */
  moves: TierMove[];
  /** Every word that cleared the share and was held back, and why. */
  heldBack: HeldBack[];
  /**
   * Every unlocked editor verdict a move, new or standing, overrides. Only a
   * `bonus` verdict can be: a move makes a word an Answer, which any other
   * verdict already leaves it, or (for `none`) leaves to prevalence.
   */
  overridden: { word: string; verdict: TierVerdict }[];
}

/**
 * Which Bonus Words move to Answer. A word moves when the one-sided lower bound
 * on its pooled find share is above `share`, it is a Bonus Word now, and it
 * clears the guards:
 *
 * - **a prevalence row, and not in the names data.** Players type words just to
 *   see what scores, so a high find share shows a word is produced, not that it
 *   is a word. Most Bonus Words with no prevalence row are names, junk and
 *   misspellings; the real ones among them are the editor's to move.
 * - **no locked editor verdict.** Evidence beats the editor's judgment unless
 *   the editor has locked it.
 *
 * Nothing here moves a word to Bonus Word. A Session that stopped early reads
 * as one that missed the word, and a move down feeds itself: a smaller maximum
 * Score brings Laureate sooner, players stop sooner, and the words they no
 * longer reach look unknown in turn.
 */
export function decideMoves(input: MoveInput): DecidedMoves {
  const moves: TierMove[] = [];
  const heldBack: HeldBack[] = [];

  for (const [word, count] of [...input.pooled].sort(([a], [b]) => a.localeCompare(b))) {
    if (input.moved.has(word) || !input.isBonusWord(word)) continue;
    const lowerBound = findShareLowerBound(count.finds, count.sessions);
    if (lowerBound <= input.share) continue;

    const move: TierMove = { word, ...count, lowerBound };
    const reason = heldBackReason(input, word);
    if (reason === null) moves.push(move);
    else heldBack.push({ ...move, reason });
  }

  const overridden: DecidedMoves["overridden"] = [];
  const allMoved = new Set([...input.moved, ...moves.map((m) => m.word)]);
  for (const word of [...allMoved].sort()) {
    const standing = input.standing.get(word);
    if (standing !== undefined && !standing.locked && standing.verdict === "bonus") {
      overridden.push({ word, verdict: standing.verdict });
    }
  }

  return { moves, heldBack, overridden };
}

// --- the moves file -------------------------------------------------------------

/**
 * `data/tier-moves.csv`: the job's own file, never `data/tier-overrides.csv`,
 * whose header says the Editor's Pass writes it and stays true. Append-only, as
 * that file is: a move is never taken back by this job, so a row is never
 * rewritten. Only the word is read at build time; the rest is the evidence the
 * move was made on, kept as an audit trail.
 */
export const TIER_MOVES_HEADER = "word,moved,finds,sessions,lower_bound";

const MOVE_COLUMNS = 5;

/** One move as a newline-terminated line, ready to append. */
export function serialiseTierMove(move: TierMove, moved: string): string {
  return `${move.word},${moved},${move.finds},${move.sessions},${move.lowerBound.toFixed(4)}\n`;
}

/**
 * Every word the file moves. A row that does not parse throws: the file is
 * machine-written, and a row quietly dropped would leave a word at the Tier the
 * evidence moved it from.
 */
export function parseTierMoves(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line === TIER_MOVES_HEADER) continue;
    const fields = line.split(",");
    if (fields.length !== MOVE_COLUMNS || !/^[a-z]+$/.test(fields[0]!)) {
      throw new Error(
        `Tier move "${line}": expected ${MOVE_COLUMNS} columns (${TIER_MOVES_HEADER}), led by a word.`,
      );
    }
    words.add(fields[0]!);
  }
  return words;
}

/** One replayed Session, as far as the Reachability lines read it. */
export interface DaySession {
  id: string;
  /** The Daily Puzzle's date. */
  date: string;
  reachedLaureate: boolean;
}

export interface ReachabilitySettings {
  /** The share of a day's Sessions that should reach Laureate. */
  floor: number;
  /** The fewest Sessions a day needs before its share says anything. */
  fewestSessions: number;
}

export interface DayUnderFloor {
  date: string;
  sessions: number;
  reached: number;
  share: number;
}

/**
 * Every day with enough Sessions where the share that reached Laureate is under
 * the floor, in date order. A day is **reported, never acted on**: a Session
 * that stopped early looks the same as one that could not go on, so nothing
 * here can tell a hard day from a short one, and the day's levers (the Laureate
 * line among them) are the maintainer's on an optional visit.
 *
 * Measured per day, because Session Records are unlinked: they can say how a
 * day went and never how a player is doing (ADR-0019).
 */
export function daysUnderFloor(
  sessions: readonly DaySession[],
  settings: ReachabilitySettings,
): DayUnderFloor[] {
  const latest = new Map<string, DaySession>();
  for (const session of sessions) latest.set(session.id, session);

  const days = new Map<string, { sessions: number; reached: number }>();
  for (const session of latest.values()) {
    const day = days.get(session.date) ?? { sessions: 0, reached: 0 };
    day.sessions += 1;
    if (session.reachedLaureate) day.reached += 1;
    days.set(session.date, day);
  }

  const under: DayUnderFloor[] = [];
  for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (day.sessions < settings.fewestSessions) continue;
    const share = day.reached / day.sessions;
    if (share < settings.floor) under.push({ date, ...day, share });
  }
  return under;
}

function heldBackReason(input: MoveInput, word: string): HeldBackReason | null {
  if (input.isName(word)) return "name";
  if (!input.hasPrevalence(word)) return "no-prevalence";
  if (input.standing.get(word)?.locked === true) return "locked";
  return null;
}
