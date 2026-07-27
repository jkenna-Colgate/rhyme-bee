/**
 * The Puzzle view: a declarative rendering of the already-tested session core.
 * It shows the Seed Word, takes Submissions through the engine's
 * `applySubmission`, and renders the result of each — a found Answer, a
 * celebrated Bonus Word, or one of the six rejection reasons, each distinctly
 * (ADR-0005). Running Score, Rank, progress and the found list are always on
 * screen, read off the `Session` facade via its `score()` / `rank()` /
 * `progress()` methods. It holds no game logic, so it is left untested, like
 * `scripts/play.ts`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { playableSeeds } from "../../src/curation.ts";
import type { RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import type { Session, SubmissionResult } from "../../src/session.ts";
import { isAccepted, type RejectionReason } from "../../src/verdict.ts";
import { speak, speechSupported } from "./speech.ts";
import { usePuzzleSession } from "./usePuzzleSession.ts";
import { FeedbackButton } from "./feedback/FeedbackButton.tsx";

/** The unscored first-run Puzzle is always seeded with `ate` (CONTEXT.md). */
const TUTORIAL_SEED = "ate";

export function PuzzleView({ index }: { index: RhymeIndex }) {
  const { session, last, seq, submit, newPuzzle } = usePuzzleSession(index, TUTORIAL_SEED);

  // The shared in-band Seed pool (#33). The boot Seed stays the fixed tutorial
  // word `ate`; only the "new puzzle" button draws from this pool.
  const pool = useMemo(() => playableSeeds(index), [index]);

  const [field, setField] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Puzzle-complete overlay (#49): fire once, on the Submission that finds the
  // *last* Answer. Bonus Words never gate completion. It is a one-shot per
  // Session — a rising edge on "every Answer found" — so it does not reappear on
  // the Bonus Words a player keeps submitting afterwards, and resets for the
  // fresh Session a new Puzzle starts (completion falls back to false there).
  const { found, totalAnswers } = session.progress();
  const isComplete = totalAnswers > 0 && found >= totalAnswers;
  const wasComplete = useRef(false);
  const [showComplete, setShowComplete] = useState(false);
  useEffect(() => {
    if (isComplete && !wasComplete.current) setShowComplete(true);
    wasComplete.current = isComplete;
  }, [isComplete]);

  function dismissComplete() {
    setShowComplete(false);
    inputRef.current?.focus();
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(field);
    setField("");
    inputRef.current?.focus();
  }

  function onNewPuzzle() {
    if (pool.length === 0) return;
    const family = pool[Math.floor(Math.random() * pool.length)]!;
    // Read the Seed off the drawn family, pinned to the family's own Rhyme Key
    // so an ambiguous representative can't misfire. Auto-speak follows for free:
    // Seed's speak effect is keyed on the Seed Word (#36).
    const seed: SeedWord = { word: family.representative, rhymeKey: family.rhymeKey };
    newPuzzle(seed);
    setField("");
    inputRef.current?.focus();
  }

  return (
    <section className="puzzle">
      <div className="puzzle__bar">
        <button type="button" className="new-puzzle" onClick={onNewPuzzle}>
          🎲 New puzzle
        </button>
      </div>
      <Seed session={session} />
      <Stats session={session} />
      {last?.rankChange && <RankBanner key={seq} label={last.rankChange.to.label} />}

      {showComplete && (
        <CompletionOverlay
          score={session.score()}
          rankLabel={session.rank().label}
          onDismiss={dismissComplete}
        />
      )}

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

      {last && <Feedback key={seq} result={last} seed={session.seed} />}
      <FoundList session={session} />

      {/* Dev-only: dead-code-eliminated from the production build (#41). */}
      {import.meta.env.DEV && <FeedbackButton session={session} />}
    </section>
  );
}

// --- The Seed Word -------------------------------------------------------------

function Seed({ session }: { session: Session }) {
  const { puzzle } = session;
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

// --- Puzzle-complete overlay (#49) ---------------------------------------------

/**
 * A dismiss-required celebration shown once the player has found every Answer,
 * so completion "cannot be missed" — the reporter kept submitting words without
 * realising there were no Answers left (#49). It does not auto-dismiss: the
 * player leaves it via an explicit action, either acknowledging or choosing to
 * keep hunting for Bonus Words (in the spirit of NYT's "admire puzzle"); both
 * return to the same board, and the caller returns focus to the input.
 *
 * Accessible as a modal: focus moves onto it on open, Escape dismisses, and the
 * primary action is keyboard-reachable. Score and Rank are read, never mutated.
 */
function CompletionOverlay({
  score,
  rankLabel,
  onDismiss,
}: {
  score: number;
  rankLabel: string;
  onDismiss: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="complete-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-title"
    >
      <div className="complete-card">
        <button
          type="button"
          className="complete-card__close"
          onClick={onDismiss}
          aria-label="Close"
        >
          ×
        </button>
        <h2 id="complete-title" className="complete-card__title">
          🏆 Puzzle complete!
        </h2>
        <p className="complete-card__body">
          You found every Answer. Final Score <b>{score}</b>, Rank <b>{rankLabel}</b>.
        </p>
        <button
          ref={primaryRef}
          type="button"
          className="complete-card__primary"
          onClick={onDismiss}
        >
          Keep hunting for Bonus Words
        </button>
      </div>
    </div>
  );
}

// --- Always-on Score / Rank / progress ----------------------------------------

function Stats({ session }: { session: Session }) {
  const { found, totalAnswers, foundBonus } = session.progress();
  return (
    <dl className="stats" aria-label="Your progress">
      <Stat label="Score" value={`${session.score()}`} />
      <Stat label="Rank" value={session.rank().label} />
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

function Feedback({ result, seed }: { result: SubmissionResult; seed: SeedWord }) {
  const { verdict, word, scoreDelta } = result;

  if (!isAccepted(verdict)) {
    return (
      <p className="feedback feedback--reject" role="status" aria-live="polite">
        <span className="feedback__badge">✗</span>
        <b className="feedback__word">{word}</b>
        <span className="feedback__note">{REJECTION_MESSAGE[verdict.reason]}</span>
        {/* Dev-only: queue a wrongly-rejected word for the supplement judge (#54
            follow-up). Dead-code-eliminated from the production build. */}
        {import.meta.env.DEV && (
          <ShouldCountButton
            word={word}
            seed={seed}
            reason={verdict.reason}
            engineRespelling={verdict.respelling ?? null}
          />
        )}
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

/**
 * Dev-only: flag a wrongly-rejected word for the supplement judge. It POSTs the
 * word with its Seed and Rhyme Key — what the judge needs to know *what it must
 * rhyme with* — to the dev-server queue; the judging (add / stress-correction /
 * derive-from-inflection / defer) happens later against that queue. Capture only
 * records, so this stays a thin fire-and-forget with a small status.
 */
function ShouldCountButton({
  word,
  seed,
  reason,
  engineRespelling,
}: {
  word: string;
  seed: SeedWord;
  reason: RejectionReason;
  engineRespelling: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "queued" | "error">("idle");

  async function flag() {
    if (status === "sending" || status === "queued") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/supplement-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word,
          seedWord: seed.word,
          seedRhymeKey: seed.rhymeKey,
          reason,
          engineRespelling,
        }),
      });
      setStatus(res.ok ? "queued" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "queued") {
    return <span className="feedback__flagged">✓ queued for the supplement</span>;
  }

  return (
    <button
      type="button"
      className="feedback__flag"
      onClick={flag}
      disabled={status === "sending"}
      title="Queue this word for the supplement judge"
    >
      {status === "error" ? "⚠ retry" : "＋ should count"}
    </button>
  );
}

/** How long a Rank-change banner lingers before it dismisses itself (#47). */
const RANK_BANNER_MS = 4000;

function RankBanner({ label }: { label: string }) {
  // The banner is re-keyed on `seq` by the parent, so every Rank change mounts a
  // fresh one and restarts this timer; without the timeout it would hang on
  // screen until the next Submission (#47).
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), RANK_BANNER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;

  return (
    <p className="rank-banner" role="status" aria-live="polite">
      🎉 New Rank: <b>{label}</b>!
    </p>
  );
}

// --- The found lists -----------------------------------------------------------

function FoundList({ session }: { session: Session }) {
  const { foundAnswers, foundBonus } = session;
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
                <span className="found__points">+{session.pointsFor(word)}</span>
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
