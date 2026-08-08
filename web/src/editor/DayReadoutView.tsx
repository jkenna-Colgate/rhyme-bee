/**
 * A day of the Editor's Pass, rendered to a screen. The second renderer over
 * `readScheduledDay`'s value; `scripts/editorRead.ts` is the first, and renders
 * it to a terminal (ADR-0016).
 *
 * **Neither renderer owns a figure of its own.** Every number here is read
 * straight off the readout — `facts.answerCount`, `facts.maxScore`,
 * `facts.difficulty`, `drift.recorded`, `drift.sizeBand`, `drift.weekdayBand`
 * — and every verdict is read off `drift.reasons`, which `checkDayDrift`
 * decided. Whether the day is inside its size band is *not* recomputed from the
 * band's edges here; that comparison is the engine's, and doing it twice is how
 * the two surfaces would come to disagree about a day. The only arithmetic on
 * this page is `.length` of a list it was handed, which is the count of the
 * items it is about to draw.
 *
 * The pass is a read, not a play. There is no Session on this screen, nothing
 * is submitted and no Score is anyone's — `maxScore` is the Puzzle's ceiling and
 * `Difficulty` is the Puzzle's, both properties of the day rather than of a
 * player.
 */

import type {
  DayReadout,
  DayWord,
  ScheduledDayReadout,
  UnpinnableDayReadout,
  UnscheduledDateReadout,
} from "../../../scripts/editorDay.ts";
import type { DriftReason } from "../../../src/schedule.ts";

export function DayReadoutView({ readout }: { readout: DayReadout }) {
  switch (readout.outcome) {
    case "unpinnable":
      return <Disagreement readout={readout} />;
    case "not-scheduled":
      return <OutsideTheRun readout={readout} />;
    case "day":
      return <ScheduledDay readout={readout} />;
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

function ScheduledDay({ readout }: { readout: ScheduledDayReadout }) {
  const { drift, facts } = readout;
  const inSizeBand = !drift.reasons.includes("answer-count-out-of-band");

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
          value={String(facts.answerCount)}
          band={
            drift.sizeBand === undefined
              ? null
              : `band ${drift.sizeBand.min}–${drift.sizeBand.max}`
          }
          inBand={drift.sizeBand === undefined ? null : inSizeBand}
        />
        <Figure label="Max Score" value={String(facts.maxScore)} band={null} inBand={null} />
        <Figure
          label="Difficulty"
          value={facts.difficulty.toFixed(4)}
          band={
            drift.weekdayBand === null
              ? null
              : `${drift.weekdayBand.weekday} band ${drift.weekdayBand.min.toFixed(4)}–${drift.weekdayBand.max.toFixed(4)}`
          }
          inBand={
            drift.weekdayBand === null ? null : !drift.reasons.includes("difficulty-out-of-band")
          }
        />
      </section>

      <p className="editor-recorded">
        The schedule recorded {drift.recorded.answerCount} Answers · Difficulty{" "}
        {drift.recorded.difficulty.toFixed(4)}
      </p>

      <Drift reasons={drift.reasons} />

      <div className="editor-lists">
        <WordList title="Answers" words={readout.answers} />
        <WordList title="Bonus Words" words={readout.bonusWords} />
      </div>
    </>
  );
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
  /** `null` where no band applies — not every figure has one, and Max Score has none. */
  inBand: boolean | null;
}) {
  return (
    <div className="editor-figure">
      <div className="editor-figure-label">{label}</div>
      <div className="editor-figure-value">{value}</div>
      {band !== null && (
        <div className={`editor-figure-band${inBand === false ? " editor-out-of-band" : ""}`}>
          {band} · {inBand === false ? "outside" : "inside"}
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

/**
 * One Tier's words. The two lists are drawn separately and never interleaved,
 * because the Answer / Bonus Word split is the thing the editor is here to
 * check and a merged list with a marker on it hides exactly that.
 *
 * Alphabetical, in columns, as the terminal renderer prints them and for the
 * same reason: the pass is conducted against a third-party rhyme list in another
 * window, and running two alphabetical lists against each other by eye is what
 * finds the missing word.
 */
function WordList({ title, words }: { title: string; words: DayWord[] }) {
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
            <li key={entry.word}>{entry.word}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
