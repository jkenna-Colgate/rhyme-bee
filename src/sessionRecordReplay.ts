/**
 * Replay a Session Record against the current Rhyme Index (ADR-0019). A record
 * carries the Submissions and never a verdict, so this is where Rank, Score and
 * each rejection with its reason are read off it.
 *
 * It replays the way `resume` in `sessionSnapshot.ts` does (start on the pinned
 * Seed, submit every Submission in order, end last if the Reveal was taken), so
 * a replay reaches the Session the game would resume. It differs in keeping
 * each Submission's verdict, which `resume` discards so a returning player is
 * not shown a burst of stale ones.
 *
 * Against the *current* index, so a record whose `indexHash` differs from the
 * build's says what today's judge makes of the Session, not exactly what the
 * player saw; a record without one (a past date when it was sent) is in that
 * position always. The caller decides what to make of that.
 */

import type { RhymeIndex, SeedWord } from "./rhymeIndex.ts";
import { Session, type Rank, type SessionOutcome } from "./session.ts";
import type { SessionRecord } from "./sessionRecord.ts";
import { REJECTION_MESSAGE, type RejectionReason, type Verdict } from "./verdict.ts";

/** One Submission's verdict on replay. */
export interface ReplayedSubmission {
  word: string;
  outcome: Verdict["outcome"];
  /** Present on a rejection only. */
  reason?: RejectionReason;
}

export interface ReplayedRejection {
  word: string;
  reason: RejectionReason;
  /** The sentence the player is shown for this reason. */
  message: string;
}

export type SessionReplay =
  | {
      replayed: true;
      record: SessionRecord;
      score: number;
      maxScore: number;
      rank: Rank;
      outcome: SessionOutcome;
      found: { answers: string[]; bonus: string[] };
      /**
       * Every word the Puzzle holds, by Tier. What a Tier move (#270) counts a
       * Session against: a Session had the chance to find each of these.
       */
      held: { answers: string[]; bonusWords: string[] };
      totalAnswers: number;
      submissions: ReplayedSubmission[];
      rejections: ReplayedRejection[];
    }
  | {
      replayed: false;
      record: SessionRecord;
      /** Why the current index cannot replay it. */
      problem: string;
    };

export function replaySessionRecord(index: RhymeIndex, record: SessionRecord): SessionReplay {
  let seed: SeedWord;
  try {
    seed = index.pinSeed(record.seed.word, record.seed.rhymeKey);
  } catch (error) {
    return {
      replayed: false,
      record,
      problem: error instanceof Error ? error.message : String(error),
    };
  }

  let session = Session.start(index, seed);
  const submissions: ReplayedSubmission[] = [];
  const rejections: ReplayedRejection[] = [];

  for (const word of record.submissions) {
    const applied = session.submit(word);
    session = applied.session;
    // An ended Session declines; a record never holds a Submission after its
    // Reveal, because the game stops taking them, so this does not arise.
    if (applied.result === null) continue;
    const { verdict } = applied.result;
    if (verdict.outcome === "rejected") {
      submissions.push({ word, outcome: "rejected", reason: verdict.reason });
      rejections.push({ word, reason: verdict.reason, message: REJECTION_MESSAGE[verdict.reason] });
    } else {
      submissions.push({ word, outcome: verdict.outcome });
    }
  }
  if (record.ended) session = session.end();

  return {
    replayed: true,
    record,
    score: session.score(),
    maxScore: session.maxScore,
    rank: session.rank(),
    outcome: session.outcome(),
    found: { answers: [...session.foundAnswers], bonus: [...session.foundBonus] },
    held: {
      answers: session.puzzle.answers.map((entry) => entry.word),
      bonusWords: session.puzzle.bonusWords.map((entry) => entry.word),
    },
    totalAnswers: session.progress().totalAnswers,
    submissions,
    rejections,
  };
}
