/**
 * The Puzzle view: a declarative rendering of the already-tested session core.
 * It shows the Seed Word, takes Submissions through the engine's
 * `applySubmission`, and renders the result of each — a found Answer, a
 * celebrated Bonus Word, or one of the six rejection reasons, each distinctly
 * (ADR-0005). Running Score, Rank, progress and the found list are always on
 * screen, read off the `Session` facade via its `score()` / `rank()` /
 * `progress()` methods. It holds no game logic, so it is left untested, like
 * `scripts/play.ts`.
 *
 * The Reveal (#62) is the same story: the view owns only the give-up gate — the
 * button, the confirmation, and dropping the entry control once the Session is
 * over. Whether a Session has ended, how it stands, and what was missed are read
 * from `session.ended` / `outcome()` / `missedAnswers()` / `missedBonusWords()`;
 * nothing here subtracts one word list from another. The plain-English rejection
 * lines come from `REJECTION_MESSAGE`, which sits with the closed reason set so
 * the REPL says the same thing.
 *
 * Sharing a Rank (#205) is wiring and nothing more: the control sits beside the
 * Rank readout on a Daily Puzzle, and every branch behind it — share sheet or
 * clipboard, and what a cancelled sheet means — belongs to `share/shareGesture`,
 * which is tested. Taking it touches no Session state.
 *
 * A Puzzle does not begin until the player taps to start (#116): iOS Safari
 * blocks speech synthesis outside a user gesture, and the Seed Word being
 * spoken is the mechanic, not a garnish — the tap *is* the audio unlock. Which
 * Puzzle boots is a separate question, decided by `bootPuzzle.ts` (#124); the
 * view only asks it and renders what comes back.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playableSeeds } from "../../src/curation.ts";
import type { PuzzleEntry, RhymeIndex, SeedWord } from "../../src/rhymeIndex.ts";
import { localCalendarDate } from "../../src/schedule.ts";
import type { RankTier } from "../../src/scoring.ts";
import type { Session, SubmissionResult } from "../../src/session.ts";
import { isAccepted, REJECTION_MESSAGE, type RejectionReason } from "../../src/verdict.ts";
import { dailyPuzzle, freePlayPuzzle, openingPuzzle, SCHEDULE, type PuzzleKind } from "./bootPuzzle.ts";
import { GAME_NAME } from "./brand.ts";
import { APPEAL_PATH } from "./endpoints.ts";
import { isFirstVisit, markVisited } from "./firstVisit.ts";
import { shareRank, type ShareContext, type ShareOutcome } from "./share/shareGesture.ts";
import { speak, speechSupported } from "./speech.ts";
import { usePuzzleSession } from "./usePuzzleSession.ts";
import { FeedbackButton } from "./feedback/FeedbackButton.tsx";

export function PuzzleView({ index }: { index: RhymeIndex }) {
  // The shared in-band Seed pool (#33), which both the opening fallback and the
  // free-play button draw from.
  const pool = useMemo(() => playableSeeds(index), [index]);

  // Read once, at mount, and held: `markVisited` fires when the player taps to
  // start, and the Tutorial they are then playing must not change underneath
  // them because the flag has since been written. Still read and still written
  // while the Tutorial is switched off (#130) — `openingPuzzle` ignores it, but
  // the flag has to stay truthful for when the Tutorial comes back.
  const [firstVisit] = useState(isFirstVisit);

  // The player's own local calendar date (ADR-0013), resolved once and reused
  // by both the boot decision and the "Today's Puzzle" control below.
  const date = useMemo(() => localCalendarDate(), []);

  // Today's Puzzle, resolved whether or not the player boots into it: a player
  // in Free Play needs the way back, and a Tutorial would too were it switched
  // on (#130). Null means the schedule has nothing for this date, and the
  // control below does not render.
  const daily = useMemo(() => dailyPuzzle(index, SCHEDULE, date), [index, date]);

  const opening = useMemo(
    () => openingPuzzle(index, pool, daily, firstVisit),
    [index, pool, daily, firstVisit],
  );

  const { session, last, seq, kind, submit, reveal, newPuzzle } = usePuzzleSession(
    index,
    opening,
  );

  const [field, setField] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // --- The start tap, and the spoken Seed that is its whole reason for being --
  //
  // The Seed Word most recently spoken aloud. The start tap speaks the first one
  // *synchronously, inside the gesture* — that call is what unlocks synthesis
  // for the rest of the visit on iOS — so the effect below must not say it a
  // second time. Every later Seed (a free-play draw) is spoken by the effect,
  // which is allowed to because the tap already unlocked it.
  const [started, setStarted] = useState(false);
  const spoken = useRef<string | null>(null);
  const seedWord = session.puzzle.seed.word;

  function start() {
    speak(seedWord);
    spoken.current = seedWord;
    // The visit has now actually happened, so spend it here rather than on
    // mount — a player who opens the link and never taps has not had their one
    // Tutorial. Kept recording while the Tutorial is off (#130), so the flag
    // still means "has played before" when it returns.
    if (firstVisit) markVisited();
    setStarted(true);
  }

  useEffect(() => {
    if (!started) return;
    if (spoken.current === seedWord) return;
    spoken.current = seedWord;
    speak(seedWord);
  }, [started, seedWord]);

  // Puzzle-complete overlay (#49): fire once, on the Submission that finds the
  // *last* Answer. Bonus Words never gate completion. It is a one-shot per
  // Session — a rising edge on "every Answer found" — so it does not reappear on
  // the Bonus Words a player keeps submitting afterwards, and resets for the
  // fresh Session a new Puzzle starts (completion falls back to false there).
  const isComplete = session.outcome() === "complete";
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

  // The Reveal (#62): a give-up gate, so the button only arms a confirmation —
  // `reveal()` is what actually ends the Session. Both missed lists are engine
  // derivations; the view reads them and never subtracts anything itself.
  const missed = useMemo(
    () => ({ answers: session.missedAnswers(), bonus: session.missedBonusWords() }),
    [session],
  );
  const [confirming, setConfirming] = useState(false);

  function takeReveal() {
    reveal();
    setConfirming(false);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(field);
    setField("");
    inputRef.current?.focus();
  }

  // Free play, the explicit extra after today's Puzzle: a fresh draw from the
  // pool, unscheduled and unsaved. The daily Session stays where it is and comes
  // back on the next load. Auto-speak follows for free: the effect above is keyed
  // on the Seed Word (#36), and the start tap has already unlocked synthesis for
  // this visit.
  function onNewPuzzle() {
    if (pool.length === 0) return;
    newPuzzle(freePlayPuzzle(index, pool));
    setField("");
    setConfirming(false);
    inputRef.current?.focus();
  }

  // The route to today's Puzzle from a Puzzle that is not it (#113): from a
  // free-play draw, and from the Tutorial were it switched on (#130). Until this
  // existed the only way on was a manual reload — the free-play draw is a
  // different Puzzle, not this one. Deliberately a control the player takes and
  // not an advance the Tutorial's end performs: finishing is not the only reason
  // to move on, and a player who is stuck should not have to finish to leave.
  //
  // Unlike free play this opens a *dateful* Puzzle, so the Session it starts is
  // filed under the player's local date and survives a reload — and if they have
  // already played some of today, `open` resumes it rather than wiping it.
  function onDailyPuzzle() {
    if (daily === null) return;
    newPuzzle(daily);
    setField("");
    setConfirming(false);
    inputRef.current?.focus();
  }

  // The Puzzle does not begin until the player taps. This is the audio unlock,
  // not decoration: without a gesture the Seed Word is never spoken on a phone,
  // and a game adjudicated against a pronunciation the player never heard is a
  // game whose premise is discovered through rejection.
  if (!started) return <StartGate kind={kind} onStart={start} />;

  return (
    <section className="puzzle">
      <div className="puzzle__bar">
        {/* Nothing left to disclose (a perfect game, Bonus Words and all) means
            no Reveal to offer — the button would end the Session for nothing.
            With every Answer already found there is nothing left to *give up*
            either, so that state skips the confirmation: the gate guards the
            Answers a player could still have found, and there are none. */}
        {!session.ended && (missed.answers.length > 0 || missed.bonus.length > 0) && (
          <button
            type="button"
            className="reveal-button"
            onClick={() => (isComplete ? takeReveal() : setConfirming(true))}
          >
            {isComplete ? "★ Show the Bonus Words I missed" : "Reveal Answers"}
          </button>
        )}
        {/* Only when there is somewhere to go: on the Daily Puzzle the player is
            already there, and a date outside the run has no Puzzle to offer. */}
        {kind !== "daily" && daily !== null && (
          <button type="button" className="daily-puzzle" onClick={onDailyPuzzle}>
            Today’s Puzzle
          </button>
        )}
        <button type="button" className="new-puzzle" onClick={onNewPuzzle}>
          Free play
        </button>
      </div>
      <Seed session={session} kind={kind} />
      <Stats session={session} kind={kind} />
      {/* Both per-Submission flashes are re-keyed on `seq` so each new Submission
          genuinely remounts them (that is what restarts the banner's dismissal
          timer), but they are siblings in this `section`, so their keys must also
          be unique *among siblings* — hence the distinct prefixes. Keying both on
          the bare `seq` collided, and React resolved the collision by dropping the
          banner's fiber while leaving its DOM node connected: an orphan whose
          timer had been cleaned up, so it hung on screen forever (#60). */}
      {last?.rankChange && (
        <RankBanner key={`rank-${seq}`} label={last.rankChange.to.label} />
      )}

      {showComplete && (
        <CompletionOverlay
          score={session.score()}
          rankLabel={session.rank().label}
          onDismiss={dismissComplete}
        />
      )}

      {confirming && (
        <GiveUpConfirm
          remaining={missed.answers.length}
          onConfirm={takeReveal}
          onCancel={() => {
            setConfirming(false);
            inputRef.current?.focus();
          }}
        />
      )}

      {/* An ended Session has no entry: the shell reflects "over" structurally,
          rather than rendering a refusal for every word typed after the fact. */}
      {session.ended ? (
        <EndedNotice
          gaveUp={session.outcome() === "given-up"}
          score={session.score()}
          rankLabel={session.rank().label}
        />
      ) : (
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
      )}

      {last && <Feedback key={`feedback-${seq}`} result={last} seed={session.seed} />}
      <FoundList session={session} />
      {session.ended && <MissedList answers={missed.answers} bonus={missed.bonus} />}

      {/* Ships in production (#118). A playtester's only channel back is what
          they can say from inside the game, so the note goes with them. */}
      <FeedbackButton session={session} />
    </section>
  );
}

// --- The start tap ------------------------------------------------------------

/**
 * What the gate calls the Puzzle behind it — one caption per kind, so each of
 * the three names itself (#132). It used to be told only whether the player was
 * in the Tutorial, and captioned everything else "Today's puzzle": a Free Play
 * draw served because the schedule had nothing for the player's date got
 * announced as today's, while the label above the Seed Word said Free play, and
 * a reload produced a *different* "today's puzzle" every time.
 *
 * Derived from the kind, not from whether a Daily Puzzle resolved. Inferring it
 * would put the same coupling back one level down, with the gate again guessing
 * at something it can simply be told.
 */
const START_TITLE: Record<PuzzleKind, string> = {
  daily: "Today’s puzzle",
  tutorial: `Welcome to ${GAME_NAME}`,
  free: "Free play",
};

/**
 * The opening beat, and the gesture browsers demand before they will speak.
 * Nothing about the Puzzle is on screen yet — the Seed Word arrives spoken and
 * written at the same moment, which is the order the game means.
 */
function StartGate({ kind, onStart }: { kind: PuzzleKind; onStart: () => void }) {
  return (
    <section className="start-gate">
      <h2 className="start-gate__title">{START_TITLE[kind]}</h2>
      {/* The sound-not-spelling sentence used to be the Tutorial's alone, and it
          was the only part of the Tutorial carrying its weight (#130). It now
          reads on every visit, whichever Puzzle follows: it is the game's
          premise, and a player who has not been told it discovers it through
          rejection. */}
      <p className="start-gate__body">
        One word, and every word you can find that rhymes with it. It is about
        sound, not spelling.
      </p>
      <button type="button" className="start-gate__start" onClick={onStart} autoFocus>
        ▶ Tap to start
      </button>
      {speechSupported() && (
        <p className="start-gate__note">
          The Seed Word is read aloud when you start, so have the sound on.
        </p>
      )}
    </section>
  );
}

// --- The Seed Word -------------------------------------------------------------

/** What each kind of Puzzle calls itself above the Seed Word. */
const SEED_LABEL: Record<PuzzleKind, string> = {
  daily: "Today’s Seed Word",
  tutorial: "Warm-up · Seed Word",
  free: "Free play · Seed Word",
};

function Seed({ session, kind }: { session: Session; kind: PuzzleKind }) {
  const { puzzle } = session;
  const word = puzzle.seed.word;

  // Speaking lives in the boot path, not here: the first utterance of a visit
  // has to come out of the start tap's own handler or iOS never plays it. The
  // visible respelling below stays the source of truth regardless of the audio.

  return (
    <header className="seed">
      {/* Which Puzzle this is. Today's is the one that is saved and shared with
          everybody else; a free-play draw is nobody else's and is not kept, so a
          player should be able to tell them apart without reloading. The Tutorial
          is neither — labelling it "Free play" told a first-time player they had
          chosen an extra before they had played anything at all. */}
      <p className="seed__label">{SEED_LABEL[kind]}</p>
      <p className="seed__word">{word}</p>
      <p className="seed__respelling">“{puzzle.seedRespelling}”</p>
      {speechSupported() && (
        <button
          type="button"
          className="seed__replay"
          onClick={() => speak(word)}
          aria-label={`Hear “${word}” again`}
        >
          Hear it again
        </button>
      )}
    </header>
  );
}

// --- Modal dialogs: the completion overlay (#49) and the give-up gate (#62) ----

/**
 * The reflex both dialogs in this shell share: move focus onto the way *out* as
 * the dialog opens, and let Escape take it. Each names its own escape hatch —
 * the completion overlay dismisses, the give-up gate cancels — but a modal that
 * only one of them was keyboard-reachable from would be a bug in whichever
 * missed it, so the behaviour lives in one place.
 */
function useDialogKeys(focusRef: React.RefObject<HTMLElement>, onEscape: () => void): void {
  useEffect(() => {
    focusRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusRef, onEscape]);
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
  useDialogKeys(primaryRef, onDismiss);

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
          Puzzle complete!
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

// --- The Reveal: confirmation, ended notice, and the missed lists (#62) --------

/**
 * The give-up gate. A Reveal ends the Session and cannot be undone (CONTEXT.md),
 * so it is never one click away: this modal asks first, and says what it costs —
 * how many Answers are still out there to find. Cancelling touches nothing.
 *
 * "Keep playing" holds the focus, so Enter or Escape on a dialog the player did
 * not mean to open backs out rather than ending their game.
 */
function GiveUpConfirm({
  remaining,
  onConfirm,
  onCancel,
}: {
  remaining: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogKeys(cancelRef, onCancel);

  return (
    <div
      className="complete-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="give-up-title"
    >
      <div className="complete-card">
        <h2 id="give-up-title" className="complete-card__title">
          Give up and reveal?
        </h2>
        <p className="complete-card__body">
          {remaining === 1
            ? "There is still 1 Answer out there."
            : `There are still ${remaining} Answers out there.`}{" "}
          Revealing ends this Puzzle: your Score and Rank stop here, and you can’t
          submit any more words.
        </p>
        <div className="give-up__actions">
          <button
            ref={cancelRef}
            type="button"
            className="complete-card__primary"
            onClick={onCancel}
          >
            Keep playing
          </button>
          <button type="button" className="give-up__confirm" onClick={onConfirm}>
            Reveal the Answers
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What stands where the entry form was once the Session is over. `gaveUp` is the
 * Session's own outcome, not a sum done here — a player who had already found
 * every Answer and only asked for the Bonus Words has not given up, and must not
 * be worded as if they had.
 */
function EndedNotice({
  gaveUp,
  score,
  rankLabel,
}: {
  gaveUp: boolean;
  score: number;
  rankLabel: string;
}) {
  return (
    <p className="ended" role="status" aria-live="polite">
      <b className="ended__title">
        {gaveUp ? "Session over. Answers revealed." : "Session over. Everything revealed."}
      </b>
      <span className="ended__detail">
        Final Score <b>{score}</b>, Rank <b>{rankLabel}</b>. Start a new Puzzle to play again.
      </span>
    </p>
  );
}

/**
 * The Reveal's two lists: the Answers the player never found and the Bonus Words
 * they never reached, both straight from the engine's derivations and in the
 * Puzzle's own order. They render *below* the found lists and styled as misses,
 * so what the player got stays theirs and distinguishable. Each group drops
 * itself when empty, so a Puzzle with no Bonus Words (or a player who collected
 * them all) reveals with no hollow heading.
 */
function MissedList({ answers, bonus }: { answers: PuzzleEntry[]; bonus: PuzzleEntry[] }) {
  return (
    <div className="missed">
      <MissedGroup title="Answers you missed" entries={answers} />
      <MissedGroup title="Bonus Words you missed" entries={bonus} bonus />
    </div>
  );
}

/** One revealed group, or nothing at all when the player missed none of it. */
function MissedGroup({
  title,
  entries,
  bonus = false,
}: {
  title: string;
  entries: PuzzleEntry[];
  bonus?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="found__group" aria-label={title}>
      <h2 className="found__title found__title--missed">
        {title} <span className="found__count">{entries.length}</span>
      </h2>
      <ul className="found__list">
        {entries.map((entry) => (
          <li
            key={entry.word}
            className={`found__item found__item--missed${bonus ? " found__item--bonus-missed" : ""}`}
          >
            {/* The respelling shows why the word rhymed — the whole point of
                seeing it, in a game adjudicated on sound (ADR-0001). */}
            <span className="missed__word">
              {bonus && "★ "}
              {entry.word}
            </span>
            <span className="missed__respelling">“{entry.respelling}”</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Always-on Score / Rank / progress ----------------------------------------

function Stats({ session, kind }: { session: Session; kind: PuzzleKind }) {
  const { found, totalAnswers, foundBonus } = session.progress();
  return (
    <dl className="stats" aria-label="Your progress">
      <Stat label="Score" value={`${session.score()}`} />
      {/* The share control lives beside the readout rather than on the
          Rank-change banner (#205). The banner dismisses itself on a timer,
          which would turn sharing into a snap decision taken at the moment the
          player is least ready to make one; here it is in a fixed place, at
          every Rank including the lowest and at any point in a Session.

          On Free Play it is absent rather than disabled: a Free Play Session is
          nobody else’s and is not kept, and an inert control needing a sentence
          of explanation is worse than no control. */}
      <Stat
        label="Rank"
        value={session.rank().label}
        action={
          kind === "daily" ? (
            <ShareRankButton
              label={session.rank().label}
              ladder={session.context.config.rankLadder}
            />
          ) : null
        }
      />
      <Stat label="Answers" value={`${found}/${totalAnswers}`} />
      <Stat label="Bonus" value={`${foundBonus}`} />
    </dl>
  );
}

function Stat({
  label,
  value,
  action = null,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      {/* The action sits inside the `dd`, not beside it: a `div` grouping inside
          a `dl` may hold nothing but `dt` and `dd`. */}
      <dd className="stat__value">
        {value}
        {action}
      </dd>
    </div>
  );
}

/** How long the share confirmation lingers before it clears itself. */
const SHARE_NOTICE_MS = 4000;

/**
 * What each outcome is worth saying, of the four `shareGesture` reports.
 *
 * A native share sheet is its own confirmation, and a player who opened one and
 * backed out already knows what they did — both stay silent. A clipboard write
 * is invisible, and is the one the player would otherwise have no way of knowing
 * happened.
 */
const SHARE_NOTICE: Record<ShareOutcome, string | null> = {
  shared: null,
  copied: "✓ Link copied",
  dismissed: null,
  failed: "⚠ Couldn’t share",
};

/**
 * Share the Rank the player is standing on (#205).
 *
 * Wiring only. Which gesture this browser gets, what URL goes into it and what
 * counts as a cancelled share are all `shareGesture`’s, where they are tested;
 * what is left here is a button, the browser’s capabilities, and the sentence
 * each outcome deserves.
 *
 * Its props are a label and a ladder rather than the `Session` they were read
 * off, so sharing cannot end or alter a Puzzle and has nothing to disclose about
 * the Answers still unfound — structurally, rather than as a promise in a
 * comment. It is not a Reveal, and there is nothing here that could make it one.
 *
 * A browser with neither a share sheet nor a clipboard gets no control at all,
 * for the same reason Free Play does not: every press would fail, and an
 * interface should never offer something inert.
 */
function ShareRankButton({ label, ladder }: { label: string; ladder: RankTier[] }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [sharing, setSharing] = useState(false);
  const capabilities = browserShareCapabilities();

  // The confirmation is a flash rather than a state the board sits in: left
  // standing it would still be there beside a Rank the player has since passed.
  // The control itself is permanent — it is the message that is timed.
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => setOutcome(null), SHARE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  if (capabilities.share === undefined && capabilities.copy === undefined) return null;

  async function share() {
    // A second press while a share sheet is open would open a second sheet. The
    // button stays enabled through it regardless: disabling would drop the focus
    // a keyboard player is standing on, to settle a race this guard settles.
    if (sharing) return;
    setOutcome(null);
    setSharing(true);
    try {
      // A built bundle links to its own host: the pages are static assets of
      // this same deploy, so the address bar is where the page being linked to
      // lives, and a link built from it cannot point at a deployment this
      // bundle is not the one on. The dev server is the one place that is
      // false — `shareAssetPlugin` is build-only, so nothing here has written
      // `/share/` — and it links to the built origin instead, so that a link
      // taken from a dev session still resolves.
      const origin = import.meta.env.DEV ? __SHARE_ORIGIN__ : window.location.origin;
      const context = { origin, ladder, ...capabilities };
      setOutcome(await shareRank({ label }, context));
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="stat__share"
        onClick={share}
        aria-busy={sharing}
        aria-label={`Share your Rank: ${label}`}
      >
        Share
      </button>
      {/* Rendered whether or not it has anything to say, so the live region is
          on the page before the text arrives — one inserted along with its
          message is announced unreliably. */}
      <span className="stat__share-notice" role="status" aria-live="polite">
        {outcome === null ? "" : SHARE_NOTICE[outcome]}
      </span>
    </>
  );
}

/**
 * What this browser can do, as values.
 *
 * `shareGesture` is handed its capabilities rather than reading `navigator` for
 * itself, which is what leaves both of its paths testable in whichever browser
 * the suite runs in. Somebody still has to look, and looking is the view’s job:
 * this is the wiring that pays for the branch not being here. Both are bound —
 * called detached from the object that owns them, they throw.
 */
function browserShareCapabilities(): Pick<ShareContext, "share" | "copy"> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  return {
    share: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
    copy:
      typeof clipboard?.writeText === "function" ? (text) => clipboard.writeText(text) : undefined,
  };
}

// --- Per-Submission feedback: every Verdict rendered distinctly (ADR-0005) -----
//
// The glyph rule, for whoever reaches for the next one (#131): keep a glyph only
// where it *encodes a verdict*, and delete every glyph that decorates a label.
// ✓ ✗ ★ below each carry meaning no adjacent word repeats — the star is the only
// thing separating a Bonus Word from an Answer in the found list, and replacing
// it costs either words or colour. The emoji that once sat on Free play, the
// Reveal, the Puzzle-complete card and the rest said nothing the button did not
// already say, and made the interface read as machine-generated.

/** Plain-English messages for the closed rejection set — one distinct line each. */
function Feedback({ result, seed }: { result: SubmissionResult; seed: SeedWord }) {
  const { verdict, word, scoreDelta } = result;

  if (!isAccepted(verdict)) {
    return (
      <p className="feedback feedback--reject" role="status" aria-live="polite">
        <span className="feedback__badge">✗</span>
        <b className="feedback__word">{word}</b>
        <span className="feedback__note">{REJECTION_MESSAGE[verdict.reason]}</span>
        {/* Ships in production (#119). Nothing observes what players submit
            (ADR-0013), so a rejection the player disagrees with is only ever
            known because they said so — this control is the sensor. */}
        <ShouldCountButton
          word={word}
          seed={seed}
          reason={verdict.reason}
          engineRespelling={verdict.respelling ?? null}
        />
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
    </p>
  );
}

/**
 * Report a Submission the player believes should have counted as an Answer. One
 * tap on the rejection sends the word with its Seed Word, the Seed's Rhyme Key,
 * the reason it was refused and the reading the engine used — everything the
 * supplement judge needs, so the player never retypes the word or explains
 * themselves. The judging (add / stress-correction / derive-from-inflection /
 * defer) happens later against the queue this feeds.
 *
 * Reporting is out of band and may fail freely: the verdict was already reached
 * in the browser (ADR-0013), so an endpoint that is down or unreachable costs a
 * report, never a Puzzle. That is why this is a thin fire-and-forget with a
 * small status and no retry loop — the failure is shown, and play carries on.
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
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function appeal() {
    if (status === "sending" || status === "sent") return;
    setStatus("sending");
    try {
      const res = await fetch(APPEAL_PATH, {
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
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <span className="feedback__appealed" role="status" aria-live="polite">
        ✓ thanks, sent
      </span>
    );
  }

  return (
    <button
      type="button"
      className="feedback__appeal"
      onClick={appeal}
      disabled={status === "sending"}
      title="Tell us this word should have counted"
    >
      {status === "error" ? "⚠ didn’t send, retry" : "＋ should count"}
    </button>
  );
}

/** How long a Rank-change banner lingers before it dismisses itself (#47). */
const RANK_BANNER_MS = 4000;

function RankBanner({ label }: { label: string }) {
  // The banner is re-keyed `rank-${seq}` by the parent, so every Rank change
  // mounts a fresh one and restarts this timer; without the timeout it would hang
  // on screen until the next Submission (#47). The remount is only real while
  // that key stays unique among its siblings (#60).
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), RANK_BANNER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;

  return (
    <p className="rank-banner" role="status" aria-live="polite">
      New Rank: <b>{label}</b>!
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
          // Once the Session is over there is no entry control to point at.
          <p className="found__empty">
            {session.ended ? "You found no Answers this time." : "No Answers yet. Type one above."}
          </p>
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
