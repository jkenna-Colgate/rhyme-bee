/**
 * The Puzzle view: builds a session on the fixed tutorial Seed Word `ate` and
 * shows the Seed Word prominently with its respelling beside it. This is the
 * #34 slice — booting one real Puzzle into the browser; play (#35) builds on it.
 */

import { useMemo } from "react";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import { startSession } from "../../src/session.ts";

/** The unscored first-run Puzzle is always seeded with `ate` (CONTEXT.md). */
const TUTORIAL_SEED = "ate";

export function PuzzleView({ index }: { index: RhymeIndex }) {
  const context = useMemo(() => startSession(index, TUTORIAL_SEED), [index]);
  const { puzzle } = context;

  return (
    <section className="puzzle">
      <header className="seed">
        <p className="seed__label">Seed Word</p>
        <p className="seed__word">{puzzle.seed.word}</p>
        <p className="seed__respelling">“{puzzle.seedRespelling}”</p>
      </header>
      <p className="puzzle__prompt">Find as many words as you can that rhyme with it.</p>
    </section>
  );
}
