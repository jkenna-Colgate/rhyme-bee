/**
 * The web shell's root. It loads the built Rhyme Index, shows a loading state
 * while it fetches and a distinct error state if it fails, and once ready hands
 * the index to the Puzzle view. The shell adds no game logic; every value it
 * shows is derived from the tested engine core in ../src.
 */

import { useRhymeIndex } from "./useRhymeIndex.ts";
import { PuzzleView } from "./PuzzleView.tsx";

export function App() {
  const load = useRhymeIndex();

  return (
    <main className="shell">
      <h1 className="shell__brand">Rhyme Bee</h1>
      {load.status === "loading" && <Loading />}
      {load.status === "error" && <LoadError message={load.message} />}
      {load.status === "ready" && <PuzzleView index={load.index} />}
    </main>
  );
}

function Loading() {
  return (
    <section className="state" role="status" aria-live="polite">
      <p className="state__spinner" aria-hidden="true" />
      <p>Loading today’s words…</p>
    </section>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <section className="state state--error" role="alert">
      <p className="state__title">Couldn’t load the puzzle.</p>
      <p className="state__detail">{message}</p>
      <p className="state__hint">
        Build the index first with <code>npm run build:index</code>, then reload.
      </p>
    </section>
  );
}
