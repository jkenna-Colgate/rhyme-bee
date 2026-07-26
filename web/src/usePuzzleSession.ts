/**
 * Holds one Puzzle in progress as a single `Game` — the session facade that
 * bundles the immutable context and the current play-state, so the view reads
 * Score, Rank, progress and the found lists off `game` via its methods rather
 * than threading `(context, state)` through selectors. Every Submission is driven
 * through `game.submit`, which delegates to the engine's `applySubmission`; the
 * shell adds no game logic and introduces no seam below `session.ts`. Because a
 * `Game` is a value (submit returns a fresh one), a single `useState` cell drives
 * re-renders — nothing is denormalised here.
 */

import { useCallback, useState } from "react";
import type { RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import { Game, startGame } from "../../src/game.ts";
import type { SubmissionResult } from "../../src/session.ts";

export interface PuzzleSession {
  game: Game;
  /** The transient "what just happened" of the most recent Submission. */
  last: SubmissionResult | null;
  /** Increments per Submission, so the view can re-key a per-Submission flash. */
  seq: number;
  submit: (raw: string) => void;
  /** Start a fresh Puzzle on `seed`, clearing the found words, Score and Rank. */
  newPuzzle: (seed: string | SeedWord) => void;
}

export function usePuzzleSession(index: RhymeIndex, seed: string): PuzzleSession {
  const [game, setGame] = useState<Game>(() => startGame(index, seed));
  const [last, setLast] = useState<SubmissionResult | null>(null);
  const [seq, setSeq] = useState(0);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return;
      const applied = game.submit(trimmed);
      setGame(applied.game);
      setLast(applied.result);
      setSeq((n) => n + 1);
    },
    [game],
  );

  const newPuzzle = useCallback(
    (nextSeed: string | SeedWord) => {
      // A fresh Game replaces the whole context and starts empty; Score / Rank
      // fall out because they are derived from the game, never stored.
      setGame(startGame(index, nextSeed));
      setLast(null);
      setSeq((n) => n + 1);
    },
    [index],
  );

  return { game, last, seq, submit, newPuzzle };
}
