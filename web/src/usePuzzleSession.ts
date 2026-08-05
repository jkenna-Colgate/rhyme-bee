/**
 * Holds one Session — the facade that bundles the immutable context and the
 * current play-state — so the view reads Score, Rank, progress and the found
 * lists off `session` via its methods rather than threading `(context, state)`
 * through selectors. Every Submission is driven through `session.submit`, which
 * delegates to the engine's `applySubmission`; the shell adds no game logic and
 * introduces no seam below `session.ts`. Because a Session is a value (submit
 * returns a fresh one), a single `useState` cell drives re-renders — nothing is
 * denormalised here.
 */

import { useCallback, useState } from "react";
import type { RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import { Session, type SubmissionResult } from "../../src/session.ts";

export interface PuzzleSession {
  session: Session;
  /** The transient "what just happened" of the most recent Submission. */
  last: SubmissionResult | null;
  /**
   * Increments per Submission, so the view can re-key its per-Submission
   * flashes. Each gets its own prefix over this counter: they are siblings, and
   * sharing a bare `seq` orphaned one of them out of React's tree (#60).
   */
  seq: number;
  submit: (raw: string) => void;
  /**
   * Take the Reveal: end the Session, freezing Score and Rank. The view gates
   * this behind a confirmation; the engine decides what ending means.
   */
  reveal: () => void;
  /** Start a fresh Puzzle on `seed`, clearing the found words, Score and Rank. */
  newPuzzle: (seed: string | SeedWord) => void;
}

export function usePuzzleSession(index: RhymeIndex, seed: string | SeedWord): PuzzleSession {
  const [session, setSession] = useState<Session>(() => Session.start(index, seed));
  const [last, setLast] = useState<SubmissionResult | null>(null);
  const [seq, setSeq] = useState(0);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return;
      const applied = session.submit(trimmed);
      // An ended Session declines with a null result: nothing happened, so leave
      // the last feedback alone rather than flashing an empty one. The view stops
      // rendering the entry control at that point, so this is a backstop.
      if (applied.result === null) return;
      setSession(applied.session);
      setLast(applied.result);
      setSeq((n) => n + 1);
    },
    [session],
  );

  const reveal = useCallback(() => {
    // The ended Session is a new value; Score and Rank freeze because they were
    // never stored, and the missed lists come off the same Session.
    setSession((current) => current.end());
    setLast(null);
    setSeq((n) => n + 1);
  }, []);

  const newPuzzle = useCallback(
    (nextSeed: string | SeedWord) => {
      // A fresh Session replaces the whole context and starts empty; Score / Rank
      // fall out because they are derived from the Session, never stored.
      setSession(Session.start(index, nextSeed));
      setLast(null);
      setSeq((n) => n + 1);
    },
    [index],
  );

  return { session, last, seq, submit, reveal, newPuzzle };
}
