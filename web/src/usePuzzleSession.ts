/**
 * Holds one Session — the facade that bundles the immutable context and the
 * current play-state — so the view reads Score, Rank, progress and the found
 * lists off `session` via its methods rather than threading `(context, state)`
 * through selectors. Every Submission is driven through `session.submit`, which
 * delegates to the engine's `applySubmission`; the shell adds no game logic and
 * introduces no seam below `session.ts`. Because a Session is a value (submit
 * returns a fresh one), a single `useState` cell drives re-renders — nothing is
 * denormalised here.
 *
 * It also holds the daily Puzzle's persistence, and this is the *only* place in
 * the game that touches `localStorage`. The format is the engine's
 * (`sessionSnapshot.ts`); the transport is this file's, and it stays thin,
 * untested I/O — the same principle under which the browser index loader is left
 * untested. What is written is the raw Submissions in order, never the verdicts,
 * so a resume replays them through whatever judge shipped today and a word
 * wrongly refused last week starts counting on its own.
 *
 * Only the daily Puzzle persists. A free-play Seed is drawn at random and has no
 * stable date to key on, so a free-play Session is deliberately not saved.
 */

import { useCallback, useState } from "react";
import type { RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import { Session, type SubmissionResult } from "../../src/session.ts";
import { resume, snapshot, snapshotKey } from "../../src/sessionSnapshot.ts";

/** The Puzzle the hook opens on: today's from the schedule, or a free-play draw. */
export interface OpeningPuzzle {
  /** The schedule date this Puzzle belongs to. Null means free play — not saved. */
  date: string | null;
  seed: string | SeedWord;
}

export interface PuzzleSession {
  session: Session;
  /** The transient "what just happened" of the most recent Submission. */
  last: SubmissionResult | null;
  /**
   * Increments per Submission, so the view can re-key its per-Submission
   * flashes. Each gets its own prefix over this counter: they are siblings, and
   * sharing a bare `seq` orphaned one of them out of React's tree (#60).
   *
   * A resume does not advance it and produces no `last`: replay reconstructs
   * state through `resume`, which returns no `SubmissionResult` at all, so a
   * returning player is not shown a burst of stale verdicts.
   */
  seq: number;
  /** Whether this is the scheduled Puzzle of the day, as opposed to a free one. */
  isDaily: boolean;
  submit: (raw: string) => void;
  /**
   * Take the Reveal: end the Session, freezing Score and Rank. The view gates
   * this behind a confirmation; the engine decides what ending means. The ending
   * is persisted, so a reload cannot un-end it and hand over the answer sheet.
   */
  reveal: () => void;
  /** Start a fresh free-play Puzzle on `seed`, clearing the found words, Score and Rank. */
  newPuzzle: (seed: string | SeedWord) => void;
}

/**
 * The Session as this hook holds it: the engine's Session, the raw Submission
 * log the Session deliberately does not keep, and the schedule date the pair is
 * filed under. They move together so the log can never drift from the Session it
 * describes.
 */
interface Play {
  session: Session;
  submissions: readonly string[];
  date: string | null;
}

/** A blocked or full store costs the resume, never the Puzzle. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, raw: string): void {
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Private browsing and a full quota both land here. Nothing to do: the
    // Session in memory is unaffected and the game plays on.
  }
}

function save(play: Play): void {
  if (play.date === null) return;
  write(
    snapshotKey(play.date),
    snapshot({ session: play.session, submissions: play.submissions }, { date: play.date }),
  );
}

/** Open the Puzzle: resume the day's saved Session, or start a fresh one. */
function open(index: RhymeIndex, opening: OpeningPuzzle): Play {
  const seed = typeof opening.seed === "string" ? index.pinSeed(opening.seed) : opening.seed;
  if (opening.date === null) {
    return { session: Session.start(index, seed), submissions: [], date: null };
  }
  // `resume` is total: absent, corrupt and stale snapshots all come back as a
  // fresh Session, so there is nothing here to branch on.
  const resumed = resume(index, seed, read(snapshotKey(opening.date)));
  return { session: resumed.session, submissions: resumed.submissions, date: opening.date };
}

export function usePuzzleSession(index: RhymeIndex, opening: OpeningPuzzle): PuzzleSession {
  const [play, setPlay] = useState<Play>(() => open(index, opening));
  const [last, setLast] = useState<SubmissionResult | null>(null);
  const [seq, setSeq] = useState(0);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return;
      const applied = play.session.submit(trimmed);
      // An ended Session declines with a null result: nothing happened, so leave
      // the last feedback alone rather than flashing an empty one. The view stops
      // rendering the entry control at that point, so this is a backstop.
      if (applied.result === null) return;
      // The Submission is logged whether it landed or not. A refusal changes no
      // state, but it is exactly what has to be replayed for a corrected judge to
      // reach it later — that is the whole of healing.
      const next: Play = {
        ...play,
        session: applied.session,
        submissions: [...play.submissions, trimmed],
      };
      setPlay(next);
      save(next);
      setLast(applied.result);
      setSeq((n) => n + 1);
    },
    [play],
  );

  const reveal = useCallback(() => {
    // The ended Session is a new value; Score and Rank freeze because they were
    // never stored, and the missed lists come off the same Session. The ending is
    // written down: without it a player reads every missed Answer, reloads, and
    // carries on with the answer sheet, which is what the give-up gate exists to
    // prevent.
    const next: Play = { ...play, session: play.session.end() };
    setPlay(next);
    save(next);
    setLast(null);
    setSeq((n) => n + 1);
  }, [play]);

  const newPuzzle = useCallback(
    (nextSeed: string | SeedWord) => {
      // A fresh Session replaces the whole context and starts empty; Score / Rank
      // fall out because they are derived from the Session, never stored. Free
      // play carries no date, so nothing about it is written down — and the saved
      // daily Session is left exactly where it was, to be found on the next load.
      setPlay(open(index, { date: null, seed: nextSeed }));
      setLast(null);
      setSeq((n) => n + 1);
    },
    [index],
  );

  return {
    session: play.session,
    last,
    seq,
    isDaily: play.date !== null,
    submit,
    reveal,
    newPuzzle,
  };
}
