/**
 * Holds one Puzzle in progress: the immutable `PuzzleContext` and the mutable
 * `PlayState` that is the single source of truth. Every Submission is driven
 * through the engine's `applySubmission` — the shell adds no game logic and
 * introduces no seam below `session.ts`. Score, Rank and progress are never
 * stored here; the view derives them on demand from `context` + `state` via the
 * `score` / `rank` / `progress` selectors.
 */

import { useCallback, useState } from "react";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import {
  applySubmission,
  emptyPlayState,
  startSession,
  type PlayState,
  type PuzzleContext,
  type SubmissionResult,
} from "../../src/session.ts";

export interface PuzzleSession {
  context: PuzzleContext;
  state: PlayState;
  /** The transient "what just happened" of the most recent Submission. */
  last: SubmissionResult | null;
  /** Increments per Submission, so the view can re-key a per-Submission flash. */
  seq: number;
  submit: (raw: string) => void;
}

export function usePuzzleSession(index: RhymeIndex, seed: string): PuzzleSession {
  const [context] = useState<PuzzleContext>(() => startSession(index, seed));
  const [state, setState] = useState<PlayState>(emptyPlayState);
  const [last, setLast] = useState<SubmissionResult | null>(null);
  const [seq, setSeq] = useState(0);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return;
      const applied = applySubmission(context, state, trimmed);
      setState(applied.state);
      setLast(applied.result);
      setSeq((n) => n + 1);
    },
    [context, state],
  );

  return { context, state, last, seq, submit };
}
