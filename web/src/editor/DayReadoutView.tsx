/**
 * A day of the Editor's Pass, rendered to a screen. The second renderer over
 * `readScheduledDay`'s value; `scripts/editorRead.ts` is the first, and renders
 * it to a terminal (ADR-0016).
 *
 * **No figure on this page is this page's own.** Every number is either read
 * straight off the readout Node computed, or — once the Tier picker has moved a
 * word — recomputed by `retierDay`, which calls the engine's own `measureAnswers`
 * over the rearranged list. Neither path restates the scoring formula, the rare
 * cutoff or the Difficulty ratio here. Whether the day is inside its size band is
 * *not* recomputed at all: that comparison is `checkDayDrift`'s, and the one case
 * where it would go stale — figures moved by a judgement the index has not been
 * rebuilt with — is answered by withdrawing the verdict rather than by guessing
 * at it. A stale verdict displayed as a current one is the failure worth ruling
 * out.
 *
 * The pass is a read, not a play. There is no Session on this screen, nothing is
 * submitted and no Score is anyone's — `maxScore` is the Puzzle's ceiling and
 * Difficulty is the Puzzle's, both properties of the day rather than of a player.
 */

import { useState } from "react";
import type {
  DayReadout,
  DayWord,
  ScheduledDayReadout,
  UnpinnableDayReadout,
  UnscheduledDateReadout,
} from "../../../scripts/editorDay.ts";
import { DEMOTION_REASONS, type Demotion, type DemotionReason } from "../../../src/demotions.ts";
import type { DriftReason, PuzzleFacts } from "../../../src/schedule.ts";
import { VERDICTS, type TierVerdict } from "../../../src/tierOverride.ts";
import { AddQueueView } from "./AddQueueView.tsx";
import { demotedWords, showsDemotionReassurance, withoutDemoted } from "./demote.ts";
import { retierDay, type RetieredWord } from "./retier.ts";
import type { EditorStatus } from "./status.ts";
import type { Adder } from "./useAdder.ts";
import type { Demoter } from "./useDemoter.ts";
import type { TierPicker } from "./useTierPicker.ts";

export function DayReadoutView({
  readout,
  picker,
  demoter,
  adder,
  status,
}: {
  readout: DayReadout;
  picker: TierPicker;
  demoter: Demoter;
  adder: Adder;
  /**
   * The repository's state, carried through to `AddQueueView`, which is the
   * actual reader: Submit's enabling rule is half the queue and half the index
   * (#162), and the button that reads it lives inside the "day" case below.
   * `StatusView` is what renders the fact itself, one level up in `EditorApp`,
   * and does not need this value at all.
   *
   * `status`, `picker`, `demoter` and `adder` all cross this component the same
   * way — as data the *switch on `readout.outcome`* below neither reads nor
   * changes — because `EditorApp` is the one place all four are held, and this
   * is the one component standing between it and the case that needs any of
   * them. Giving `status` its own path around this switch (a second prop
   * threaded straight into `ScheduledDay`'s render, say, or a context read
   * lower down) would be a second mechanism for the one thing the other three
   * already do by being threaded, to save one value one hop — and would still
   * have to cross `ScheduledDay`, which forwards it exactly this component
   * does, for the identical reason: `AddQueueView` is one level further in.
   */
  status: EditorStatus | null;
}) {
  switch (readout.outcome) {
    case "unpinnable":
      return <Disagreement readout={readout} />;
    case "not-scheduled":
      return <OutsideTheRun readout={readout} />;
    case "day":
      return (
        <ScheduledDay
          readout={readout}
          picker={picker}
          demoter={demoter}
          adder={adder}
          status={status}
        />
      );
  }
}

/**
 * The schedule/index disagreement, and the loudest thing this screen can say.
 *
 * It outranks drift, because a day that cannot be built at all is a worse fact
 * than a day whose figures merely moved: in production this is silent — the boot
 * policy catches the throw and hands the player Free Play instead of the Daily
 * Puzzle (#126) — so meeting it here is the entire point. The two cannot appear
 * together on one day, so the ranking is weight rather than order: the
 * disagreement takes the whole screen and leaves no figures beside it, where
 * drift is an advisory line under figures that are still real.
 *
 * It names *both* keys, because the repair is a choice between them, and offers
 * no repair: repinning is out of scope (#158), and a button that rewrote the
 * reviewed schedule artifact from a browser would be the wrong thing to build
 * first in any case.
 */
function Disagreement({ readout }: { readout: UnpinnableDayReadout }) {
  return (
    <section className="editor-alarm">
      <h2>Schedule / index disagreement</h2>
      <p className="editor-alarm-lede">
        The Seed Word <strong>{readout.seed}</strong> cannot be pinned to the Rhyme Key this day
        was scheduled with, so there is no Puzzle here to read.
      </p>
      <dl className="editor-pairs">
        <dt>Scheduled Rhyme Key</dt>
        <dd>
          <code>{readout.scheduledRhymeKey}</code>
        </dd>
        <dt>Rhyme Keys the index holds</dt>
        <dd>
          {readout.indexRhymeKeys.length === 0 ? (
            <em>none — the index has no reading of this spelling at all</em>
          ) : (
            readout.indexRhymeKeys.map((key) => (
              <code key={key} className="editor-key">
                {key}
              </code>
            ))
          )}
        </dd>
      </dl>
      <p className="editor-detail">{readout.detail}</p>
      <p>
        A player asking for {readout.date} would be handed Free Play instead, silently. Correct the
        day in <code>data/schedule.json</code>, or rebuild the index with{" "}
        <code>npm run build:index</code>.
      </p>
    </section>
  );
}

/**
 * A date the run does not cover. It names the edges rather than showing nothing,
 * so a typo reads as a typo instead of as an empty screen.
 */
function OutsideTheRun({ readout }: { readout: UnscheduledDateReadout }) {
  return (
    <section className="editor-empty">
      <h2>No Daily Puzzle on {readout.date}</h2>
      <p>
        The run covers <strong>{readout.firstDate}</strong> to <strong>{readout.lastDate}</strong>.
      </p>
    </section>
  );
}

function ScheduledDay({
  readout,
  picker,
  demoter,
  adder,
  status,
}: {
  readout: ScheduledDayReadout;
  picker: TierPicker;
  demoter: Demoter;
  adder: Adder;
  /** Read by nothing here either — forwarded to `AddQueueView` below, for the
   * reason given on `DayReadoutView`'s own `status` prop. */
  status: EditorStatus | null;
}) {
  const { drift } = readout;
  // Which word's menu is showing. One at a time: the menu is a choice about one
  // word, and two open at once would invite a click meant for the other.
  const [picking, setPicking] = useState<string | null>(null);

  // A state fetched for another day must not be applied to this one — the two
  // requests are independent and either can land first. The demotion list needs
  // no such check: it names words rather than a day, so it is the same list
  // whichever day is on screen.
  const state = picker.state?.date === readout.date ? picker.state : null;

  // The demoted words come out **before** anything is re-tiered, because a
  // demotion is not a Tier: it withdraws wordhood, so the word leaves the Puzzle
  // rather than moving between its two lists, and re-tiering a word that is no
  // longer in the day would be asking which Tier a non-word is.
  const day = withoutDemoted(
    { answers: readout.answers, bonusWords: readout.bonusWords },
    readout.facts,
    demotedWords(demoter.state?.standing ?? []),
  );
  const shown =
    state === null
      ? {
          answers: day.lists.answers.map(unjudged),
          bonusWords: day.lists.bonusWords.map(unjudged),
          facts: day.facts,
        }
      : retierDay(day.lists, state);

  // Corrections made since the artifact was built — a Tier verdict or a
  // demotion, since both move the figures. The band verdicts below were decided
  // against the figures as built, so this is also what makes them stale.
  const moved = !sameFigures(shown.facts, readout.facts);

  const judge = (word: string, verdict: TierVerdict) => {
    setPicking(null);
    void picker.judge(word, verdict);
  };

  const demote = (word: string, reason: DemotionReason) => {
    setPicking(null);
    void demoter.demote(word, reason);
  };

  // Exactly one of these is ever non-null: `WordList` disables every word
  // button in both lists the instant either write starts (`disabled={writing
  // !== null}`), so a second write cannot begin until the first has cleared
  // its own `writing` back to null. The merge is safe for that reason rather
  // than by construction, which is why it is named and explained once here
  // instead of repeated inline at each of the two `<WordList>`s below.
  const writing = picker.writing ?? demoter.writing;

  return (
    <>
      <header className="editor-day-head">
        <h2>
          {readout.date} <span className="editor-muted">{readout.weekday} · week {readout.week}</span>
        </h2>
      </header>

      {/* The pronunciation the day adjudicates against, first and on its own:
          the editor is about to judge a list of words as rhymes, and which
          reading of the Seed Word they are rhymes *of* is the fact that decides
          every one of those judgements. */}
      <section className="editor-seed">
        <div className="editor-seed-word">{readout.seed}</div>
        <div className="editor-seed-said">spoken “{readout.seedRespelling}”</div>
        <div className="editor-seed-key">
          Rhyme Key <code>{readout.rhymeKey}</code>
        </div>
      </section>

      {/* A long session and a hard one are different things, so the Answer count
          and the Difficulty are shown against their own bands rather than run
          together. Band membership is advisory after review (ADR-0012) — it is
          reported and never enforced, and nothing here blocks on it. */}
      <section className="editor-figures">
        <Figure
          label="Answers"
          value={String(shown.facts.answerCount)}
          band={
            drift.sizeBand === undefined
              ? null
              : `band ${drift.sizeBand.min}–${drift.sizeBand.max}`
          }
          inBand={
            drift.sizeBand === undefined || moved
              ? null
              : !drift.reasons.includes("answer-count-out-of-band")
          }
        />
        <Figure label="Max Score" value={String(shown.facts.maxScore)} band={null} inBand={null} />
        <Figure
          label="Difficulty"
          value={shown.facts.difficulty.toFixed(4)}
          band={
            drift.weekdayBand === null
              ? null
              : `${drift.weekdayBand.weekday} band ${drift.weekdayBand.min.toFixed(4)}–${drift.weekdayBand.max.toFixed(4)}`
          }
          inBand={
            drift.weekdayBand === null || moved
              ? null
              : !drift.reasons.includes("difficulty-out-of-band")
          }
        />
      </section>

      <p className="editor-recorded">
        The schedule recorded {drift.recorded.answerCount} Answers · Difficulty{" "}
        {drift.recorded.difficulty.toFixed(4)}
      </p>

      {moved && (
        <p className="editor-moved">
          Your corrections have moved this day. The built index still reads{" "}
          {readout.facts.answerCount} Answers · Max Score {readout.facts.maxScore} · Difficulty{" "}
          {readout.facts.difficulty.toFixed(4)}, so the band verdicts are withheld until{" "}
          <code>npm run build:index</code> folds them in.
        </p>
      )}

      {!moved && <Drift reasons={drift.reasons} />}

      {picker.error !== null && (
        <p className="editor-write-failed">{picker.error} The day is unchanged.</p>
      )}

      {/* A refused demotion is the louder of the two: the word is still being
          served, and the editor has already moved on to the next one. Not on
          a 409, though — that sentence already says the word has no wordhood
          ("kate is already demoted, as proper-noun"), so appending "the word
          is still a word" would contradict what the endpoint just said. */}
      {demoter.error !== null && (
        <p className="editor-write-failed">
          {demoter.error}
          {showsDemotionReassurance(demoter.alreadyDemoted) && (
            <>
              {" "}
              <strong>Nothing was demoted</strong> — the word is still a word.
            </>
          )}
        </p>
      )}

      {picker.recorded !== null && <Recorded recorded={picker.recorded} />}

      {demoter.recorded !== null && <Demoted demotion={demoter.recorded} />}

      {/* Said once, above both lists, rather than inside every verdict menu:
          it is the same sentence for every word, and the lists are columns
          narrow enough that a paragraph in one of them squeezes the buttons
          it was meant to explain. */}
      {/* Above the lists, not below: a day can hold hundreds of words, and the
          moment the editor spots a gap is the moment they want somewhere to
          type it. The queue is aimed at this day's Rhyme Key, which is why it
          is drawn inside the scheduled-day case and nowhere else — the other
          two readouts have no key to aim at. */}
      <AddQueueView
        date={readout.date}
        rhymeKey={readout.rhymeKey}
        adder={adder}
        status={status}
      />

      <p className="editor-lists-note">
        Click a word to set its <strong>Tier</strong>. The verdict is written to{" "}
        <code>data/tier-overrides.csv</code> on click, with the prevalence measured at that moment
        beside it, and governs the word itself plus any inflected form that has no prevalence row
        of its own. The same menu removes a word that is a name or is not a word at all: that is
        written to <code>data/demotions.txt</code>, takes the word out of every Puzzle, and is
        reversed only by hand.
      </p>

      <div className="editor-lists">
        <WordList
          title="Answers"
          words={shown.answers}
          picking={picking}
          onPick={setPicking}
          onJudge={judge}
          onDemote={demote}
          writing={writing}
        />
        <WordList
          title="Bonus Words"
          words={shown.bonusWords}
          picking={picking}
          onPick={setPicking}
          onJudge={judge}
          onDemote={demote}
          writing={writing}
        />
      </div>
    </>
  );
}

/** A day with no picker state yet: the readout's own words, judged by nobody. */
function unjudged(entry: DayWord): RetieredWord {
  return { ...entry, verdict: null, rows: 0, source: null, sourceVerdict: null };
}

function sameFigures(a: PuzzleFacts, b: PuzzleFacts): boolean {
  return a.answerCount === b.answerCount && a.maxScore === b.maxScore && a.difficulty === b.difficulty;
}

function Figure({
  label,
  value,
  band,
  inBand,
}: {
  label: string;
  value: string;
  band: string | null;
  /** `null` where no band verdict applies — Max Score has none, and a day the
   * editor has moved has one that is no longer about the figure above it. */
  inBand: boolean | null;
}) {
  return (
    <div className="editor-figure">
      <div className="editor-figure-label">{label}</div>
      <div className="editor-figure-value">{value}</div>
      {band !== null && (
        <div className={`editor-figure-band${inBand === false ? " editor-out-of-band" : ""}`}>
          {band}
          {inBand !== null && ` · ${inBand ? "inside" : "outside"}`}
        </div>
      )}
    </div>
  );
}

const DRIFT_MESSAGE: Record<DriftReason, string> = {
  "answer-count-out-of-band": "Answer count is outside the size band this day was dealt from",
  "difficulty-out-of-band": "Difficulty is outside its weekday’s band",
};

/**
 * Drift, when there is any. A warning and never a gate — band membership is
 * advisory after review (ADR-0012), so this says what moved and leaves the day
 * fully readable underneath it.
 */
function Drift({ reasons }: { reasons: readonly DriftReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <section className="editor-warning">
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{DRIFT_MESSAGE[reason]}.</li>
        ))}
      </ul>
      <p>Band membership is advisory after review — this is for your eye.</p>
    </section>
  );
}

// Every key `VERDICTS` names is required here — miss one and this object
// literal fails to compile, which is the exhaustiveness check `VERDICTS` itself
// cannot give: TypeScript enforces that a `Record<TierVerdict, string>` literal
// carries all four keys and no others, so a verdict added to the type without a
// label here is a build error rather than a button with no text.
const VERDICT_LABEL: Record<TierVerdict, string> = {
  bonus: "Bonus Word",
  "answer-rare": "Answer, rare",
  "answer-common": "Answer, common",
  none: "None — prevalence governs",
};

/**
 * The last judgement written, and **what else it reached**.
 *
 * An override on a lemma also re-tiers the derived forms that have no prevalence
 * row of their own: overriding `gate` moves `gates`, `gated` and `gating` too,
 * because `RhymeIndex#tier` resolves knownness through `lemmaCandidates` and a
 * derived form falls back to its lemma — which it did for measured prevalence
 * long before overrides existed. The maintainer has ruled that **accepted**: the
 * narrow alternative would need adjudication to treat an overridden value
 * differently from a measured one, which ADR-0015 forbids.
 *
 * Accepted is not the same as invisible, and this banner is where it is made
 * visible. It reports the reach over the *whole index* rather than over the day
 * on screen, and that is deliberate: a lemma and its inflections almost never
 * share a Rhyme Key — `gate` is /eɪt/ and `gates` is /eɪts/ — so the words a
 * judgement reaches are nearly always on **other days**, where the editor would
 * not see them move. A notice confined to this day would say "nothing else
 * changed" and be wrong.
 *
 * It also shows the row exactly as the file received it, prevalence and all,
 * because that row is the audit trail ADR-0015 keeps and the editor should be
 * able to read what was recorded about their own judgement.
 */
function Recorded({ recorded }: { recorded: NonNullable<TierPicker["recorded"]> }) {
  const { appended, reach } = recorded;
  return (
    <section className="editor-written">
      <p>
        Recorded <strong>{appended.word}</strong> as{" "}
        <strong>{VERDICT_LABEL[appended.verdict]}</strong>.{" "}
        {appended.measured === null
          ? "The prevalence data had no row for it, which the file records as an empty measurement."
          : `Prevalence read ${appended.measured} at that moment.`}
      </p>
      {reach.length > 0 && (
        <p className="editor-reach">
          This also governs{" "}
          {reach.length === 1
            ? "one derived form with no prevalence row of its own"
            : `${reach.length} derived forms with no prevalence row of their own`}
          , mostly on other days: <span className="editor-reach-words">{reach.join(", ")}</span>
        </p>
      )}
    </section>
  );
}

/**
 * One Tier's words. The two lists are drawn separately and never interleaved,
 * because the Answer / Bonus Word split is the thing the editor is here to check
 * and a merged list with a marker on it hides exactly that.
 *
 * Alphabetical, in columns, as the terminal renderer prints them and for the
 * same reason: the pass is conducted against a third-party rhyme list in another
 * window, and running two alphabetical lists against each other by eye is what
 * finds the missing word.
 *
 * Every word is a button, because setting a word's Tier is the act this whole
 * mode exists for and it should cost one click on the word itself — picking from
 * a displayed list is the task a CLI is worst at (ADR-0016), and a form that
 * asked the editor to retype a word they are already looking at would have kept
 * the CLI's worst property.
 */
function WordList({
  title,
  words,
  picking,
  onPick,
  onJudge,
  onDemote,
  writing,
}: {
  title: string;
  words: RetieredWord[];
  picking: string | null;
  onPick: (word: string | null) => void;
  onJudge: (word: string, verdict: TierVerdict) => void;
  onDemote: (word: string, reason: DemotionReason) => void;
  writing: string | null;
}) {
  const sorted = [...words].sort((a, b) => a.word.localeCompare(b.word));
  return (
    <section className="editor-list">
      <h3>
        {title} <span className="editor-muted">({sorted.length})</span>
      </h3>
      {sorted.length === 0 ? (
        <p className="editor-muted">(none)</p>
      ) : (
        <ul className="editor-words">
          {sorted.map((entry) => (
            <li key={entry.word} className="editor-word-row">
              <button
                type="button"
                className="editor-word"
                aria-expanded={picking === entry.word}
                disabled={writing !== null}
                onClick={() => onPick(picking === entry.word ? null : entry.word)}
              >
                <span className="editor-word-text">{entry.word}</span>
                <Marks entry={entry} />
                {writing === entry.word && <span className="editor-mark">writing…</span>}
              </button>
              {picking === entry.word && (
                <VerdictMenu entry={entry} onJudge={onJudge} onDemote={onDemote} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What is already true of a word, at a glance: the verdict standing on it, that
 * it has been judged more than once, and — when its knownness is not its own —
 * the word it is inherited from.
 *
 * The reversal mark is the one ADR-0015 asks for by name: the file is
 * append-only and last-wins, so a word may carry several rows, and "the readout
 * flags any word carrying more than one row, so a reversal is never invisible".
 * It shows the count rather than a bare symbol, because two rows and five rows
 * are different amounts of mind-changing.
 */
function Marks({ entry }: { entry: RetieredWord }) {
  return (
    <>
      {entry.verdict !== null && (
        <span className={`editor-mark editor-verdict-${entry.verdict}`}>
          {VERDICT_LABEL[entry.verdict]}
        </span>
      )}
      {entry.rows > 1 && (
        <span
          className="editor-mark editor-reversed"
          title={`${entry.rows} rows in data/tier-overrides.csv — this word has been judged more than once`}
        >
          reversed ×{entry.rows}
        </span>
      )}
      {entry.source !== null && entry.source !== entry.word && (
        <span
          className="editor-mark editor-inherited"
          title={`No prevalence row of its own — its knownness comes from ${entry.source}`}
        >
          via {entry.source}
          {entry.sourceVerdict !== null && entry.sourceVerdict !== "none"
            ? ` (${VERDICT_LABEL[entry.sourceVerdict]})`
            : ""}
        </span>
      )}
    </>
  );
}

/**
 * The four verdicts, offered together, in the order `src/tierOverride.ts`
 * names them — the same array the CSV parser and the write route validate a
 * verdict against, so a fifth verdict added to the type shows up here without
 * anyone hand-editing a second list.
 *
 * `none` is offered as a peer of the other three and never as an "undo", because
 * withdrawing an override and reversing one are different acts (ADR-0015):
 * "undoing" a demotion with **Answer, common** would pin the word above the rare
 * cutoff and silently strip the flat bonus from a word that measured below it,
 * and the editor would believe they had reverted. So the menu says what each one
 * does rather than offering three verdicts and a back button.
 *
 * There is no confirmation step. The click *is* the record: ADR-0015 makes the
 * file append-only precisely so that a judgement can be written the instant it is
 * made without a transaction to lose, and a reversal is another click rather than
 * an undo. A confirm dialog would buy nothing that an appended `none` does not
 * already buy, and would cost the pass its pace.
 */
function VerdictMenu({
  entry,
  onJudge,
  onDemote,
}: {
  entry: RetieredWord;
  onJudge: (word: string, verdict: TierVerdict) => void;
  onDemote: (word: string, reason: DemotionReason) => void;
}) {
  return (
    <div className="editor-menu">
      <div className="editor-verdicts" role="group" aria-label={`Tier for ${entry.word}`}>
        {VERDICTS.map((verdict) => (
          <button
            type="button"
            key={verdict}
            className={`editor-verdict${
              entry.verdict === verdict ? " editor-verdict-standing" : ""
            }`}
            onClick={() => onJudge(entry.word, verdict)}
          >
            {VERDICT_LABEL[verdict]}
          </button>
        ))}
      </div>
      <DemoteMenu entry={entry} onDemote={onDemote} />
    </div>
  );
}

// Every key `DEMOTION_REASONS` names is required here — miss one and this object
// literal fails to compile, so a reason added to the type cannot become a button
// with no text. The labels name the rejection rather than the file's spelling,
// because that is what the editor is choosing: the second column of
// `data/demotions.txt` is the message the player receives.
const DEMOTION_LABEL: Record<DemotionReason, string> = {
  "proper-noun": "It’s a name",
  "not-a-known-word": "It’s not a word",
};

const DEMOTION_TITLE: Record<DemotionReason, string> = {
  "proper-noun": "Rejected as a Proper Noun — the player is told it is a name",
  "not-a-known-word": "Rejected as not a known word — no claim that it is anybody’s name",
};

/**
 * The demote gesture's **second click**. The first was the word, which opened
 * this menu; the reason is chosen here, and that pair is the whole gesture — so
 * no single misclick can take a word's wordhood, and no click can take it
 * without saying why.
 *
 * The two reasons are offered as peers rather than as one "remove" button with a
 * reason asked for afterwards, and that is not a shortcut: a third click would
 * be a confirmation step, and a confirmation step is exactly what the reason
 * already is. The reason cannot be defaulted either, because that column *is*
 * the rejection the player receives — a name that rhymes must be told it is a
 * name (CONTEXT.md), and calling an abbreviation somebody's name would be its
 * own small lie.
 *
 * There is deliberately **no un-demote**, here or anywhere in the tool. Undoing
 * one is a hand edit of `data/demotions.txt`, which is a committed file small
 * enough to open and one line long per entry. The asymmetry is the point: a
 * demotion says a string is not a word of the game, and the cost of a wrong one
 * is a single word missing from a single Puzzle, where the cost of a button that
 * puts wordhood back is a click away from serving a name as an Answer again.
 *
 * A demoted word is not in either list, so nothing in this menu ever renders for
 * one, and the two buttons never need a "standing" state the way the verdicts
 * above them do.
 */
function DemoteMenu({
  entry,
  onDemote,
}: {
  entry: RetieredWord;
  onDemote: (word: string, reason: DemotionReason) => void;
}) {
  return (
    <div className="editor-demote" role="group" aria-label={`Remove ${entry.word}`}>
      <span className="editor-demote-lede">Not a word to serve:</span>
      {DEMOTION_REASONS.map((reason) => (
        <button
          type="button"
          key={reason}
          className="editor-demote-reason"
          title={DEMOTION_TITLE[reason]}
          onClick={() => onDemote(entry.word, reason)}
        >
          {DEMOTION_LABEL[reason]}
        </button>
      ))}
    </div>
  );
}

/**
 * The last demotion written.
 *
 * It says the word is gone from *every* Puzzle rather than from this one, which
 * is the fact most easily missed: the word left the list on screen, but what was
 * actually withdrawn is its wordhood, so it is out of every Rhyme Key family it
 * ever appeared in and a player who submits it is now rejected.
 *
 * And it names the hand edit, because there is no un-demote to point at. An
 * editor who has just mis-clicked needs to know where the line is, at the moment
 * they need to know it.
 */
function Demoted({ demotion }: { demotion: Demotion }) {
  return (
    <section className="editor-written">
      <p>
        Removed <strong>{demotion.word}</strong>. {DEMOTION_TITLE[demotion.reason]}. It is out of
        every Puzzle, not just this one.
      </p>
      <p className="editor-reach">
        Written to <code>data/demotions.txt</code>. There is no undo here: delete the line to put
        the word back.
      </p>
    </section>
  );
}
