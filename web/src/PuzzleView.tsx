/**
 * The Puzzle view: a declarative rendering of the already-tested session core.
 * It shows the Seed Word, takes Submissions through the engine's
 * `applySubmission`, and renders the result of each — a found Answer, a
 * celebrated Bonus Word, or one of the six rejection reasons, each distinctly
 * (ADR-0005). Running Score, Rank, progress and the found list are always on
 * screen, derived from the core via the `score` / `rank` / `progress` selectors.
 * It holds no game logic, so it is left untested, like `scripts/play.ts`.
 */

import { useEffect, useRef, useState } from "react";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import {
  progress,
  rank,
  score,
  type PlayState,
  type PuzzleContext,
  type SubmissionResult,
} from "../../src/session.ts";
import { isAccepted, type RejectionReason } from "../../src/verdict.ts";
import { speak, speechSupported } from "./speech.ts";
import { usePuzzleSession } from "./usePuzzleSession.ts";

/** The unscored first-run Puzzle is always seeded with `ate` (CONTEXT.md). */
const TUTORIAL_SEED = "ate";

export function PuzzleView({ index }: { index: RhymeIndex }) {
  const session = usePuzzleSession(index, TUTORIAL_SEED);
  const { context, state, last, seq, submit } = session;

  const [field, setField] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(field);
    setField("");
    inputRef.current?.focus();
  }

  return (
    <section className="puzzle">
      <Seed context={context} />
      <Stats context={context} state={state} />
      {last?.rankChange && <RankBanner key={seq} label={last.rankChange.to.label} />}

      <form className="entry" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="entry__input"
          type="text"
          value={field}
          onChange={(event) => setField(event.target.value)}
          placeholder="Type a word that rhymes…"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Your rhyme"
        />
        <button className="entry__submit" type="submit">
          Submit
        </button>
      </form>

      {last && <Feedback key={seq} result={last} />}
      <FoundList context={context} state={state} />
    </section>
  );
}

// --- The Seed Word -------------------------------------------------------------

function Seed({ context }: { context: PuzzleContext }) {
  const { puzzle } = context;
  const word = puzzle.seed.word;

  // Speak the Seed aloud when the Puzzle starts. Keyed on the word, so #37's
  // new-puzzle draw (a fresh session with a new Seed) auto-speaks for free. The
  // visible respelling below stays the source of truth regardless of the audio.
  useEffect(() => {
    speak(word);
  }, [word]);

  return (
    <header className="seed">
      <p className="seed__label">Seed Word</p>
      <p className="seed__word">{word}</p>
      <p className="seed__respelling">“{puzzle.seedRespelling}”</p>
      {speechSupported() && (
        <button
          type="button"
          className="seed__replay"
          onClick={() => speak(word)}
          aria-label={`Hear “${word}” again`}
        >
          🔊 Hear it again
        </button>
      )}
    </header>
  );
}

// --- Always-on Score / Rank / progress ----------------------------------------

function Stats({ context, state }: { context: PuzzleContext; state: PlayState }) {
  const { found, totalAnswers, foundBonus } = progress(context, state);
  return (
    <dl className="stats" aria-label="Your progress">
      <Stat label="Score" value={`${score(context, state)}`} />
      <Stat label="Rank" value={rank(context, state).label} />
      <Stat label="Answers" value={`${found}/${totalAnswers}`} />
      <Stat label="Bonus" value={`${foundBonus}`} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}

// --- Per-Submission feedback: every Verdict rendered distinctly (ADR-0005) -----

/** Plain-English messages for the closed rejection set — one distinct line each. */
const REJECTION_MESSAGE: Record<RejectionReason, string> = {
  "does-not-rhyme": "doesn’t rhyme with the Seed Word",
  "is-the-seed-word": "that’s the Seed Word itself",
  "already-submitted": "you’ve already found that",
  "proper-noun": "proper nouns don’t count",
  "not-a-known-word": "not a word we know",
  malformed: "letters only, please",
};

function Feedback({ result }: { result: SubmissionResult }) {
  const { verdict, word, scoreDelta } = result;

  if (!isAccepted(verdict)) {
    return (
      <p className="feedback feedback--reject" role="status" aria-live="polite">
        <span className="feedback__badge">✗</span>
        <b className="feedback__word">{word}</b>
        <span className="feedback__note">{REJECTION_MESSAGE[verdict.reason]}</span>
      </p>
    );
  }

  if (verdict.outcome === "answer") {
    return (
      <p className="feedback feedback--answer" role="status" aria-live="polite">
        <span className="feedback__badge">✓ Answer</span>
        <b className="feedback__word">{word}</b>
        <span className="feedback__delta">+{scoreDelta}</span>
      </p>
    );
  }

  return (
    <p className="feedback feedback--bonus" role="status" aria-live="polite">
      <span className="feedback__badge">★ Bonus Word!</span>
      <b className="feedback__word">{word}</b>
      <span className="feedback__note">a real word — celebrated, but not scored</span>
    </p>
  );
}

function RankBanner({ label }: { label: string }) {
  return (
    <p className="rank-banner" role="status" aria-live="polite">
      🎉 New Rank: <b>{label}</b>!
    </p>
  );
}

// --- The found lists -----------------------------------------------------------

function FoundList({ context, state }: { context: PuzzleContext; state: PlayState }) {
  const { foundAnswers, foundBonus } = state;
  return (
    <div className="found">
      <section className="found__group" aria-label="Answers you have found">
        <h2 className="found__title">
          Answers <span className="found__count">{foundAnswers.length}</span>
        </h2>
        {foundAnswers.length === 0 ? (
          <p className="found__empty">No Answers yet — type one above.</p>
        ) : (
          <ul className="found__list">
            {foundAnswers.map((word) => (
              <li key={word} className="found__item">
                <span>{word}</span>
                <span className="found__points">+{context.answerScores.get(word) ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {foundBonus.length > 0 && (
        <section className="found__group" aria-label="Bonus Words you have found">
          <h2 className="found__title found__title--bonus">
            Bonus Words <span className="found__count">{foundBonus.length}</span>
          </h2>
          <ul className="found__list">
            {foundBonus.map((word) => (
              <li key={word} className="found__item found__item--bonus">
                <span>★ {word}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
