/**
 * The approve card: an agent's proposed reading, shown **beside the engine's
 * current one**, with the choice of replacing it or joining it (#180).
 *
 * **One card, two places.** It is drawn on a `needs-correction` Candidate, where
 * the engine holds a reading and the reading is wrong, and on a deferred add
 * whose agent-proposed reading failed verification — which is the word's honest
 * reading, and writing it is what makes the player be told "doesn't rhyme"
 * rather than "not a word we know". Those are not two features: they are one
 * proposal awaiting one approval, and #176 specifies them together precisely so
 * they are not built twice. What differs is only whether there is an existing
 * reading to join to, and `correctionModes` answers that.
 *
 * **This file decides nothing.** Which modes are offered is `correctionModes`'s,
 * what each one costs is `CORRECTION_MODE_CONSEQUENCE`'s, what a correction
 * reaches is `CORRECTION_REACH`'s, and which days moved is `movedDays`'s — all
 * of them in `correction.ts`, where a test can hold them to account. A sentence
 * that only exists inside JSX is a sentence no test can reach, which is
 * `decline.ts`'s argument for the same split.
 */

import { useState } from "react";
import type { RhymeKey } from "../../../src/phonology.ts";
import type { ReadingEvidence } from "../../../src/supplementEvidence.ts";
import {
  CORRECTION_MODE_CONSEQUENCE,
  CORRECTION_MODE_LABEL,
  CORRECTION_REACH,
  correctionModes,
  movedDays,
  type CorrectionProposal,
  type CorrectionWriteResult,
} from "./correction.ts";
import type { Corrector } from "./useCorrector.ts";

/**
 * The whole gesture for one word: the ask, the proposal, the two approvals and
 * what moved afterwards.
 *
 * `current` is the engine's readings as the card's own state already carries
 * them — the Candidate's `readings`, or nothing at all for a deferred add, whose
 * word the engine reads not at all. It is passed in rather than read off the
 * proposal so that the "before" side of the comparison is on screen *before* an
 * agent has been asked anything.
 */
export function CorrectionPanel({
  word,
  rhymeKey,
  current,
  corrector,
  ask,
  standing = null,
}: {
  word: string;
  /** The Rhyme Key this correction is judged against. */
  rhymeKey: RhymeKey;
  current: ReadingEvidence[];
  corrector: Corrector;
  /**
   * The button's own words. Absent when a proposal is already in hand and there
   * is nothing to ask for — an agent that has *already* answered must not be
   * asked again, because the second answer would be a different reading and the
   * first is the one being judged.
   */
  ask?: string;
  /**
   * A proposal the add path already made and this card is offering, rather than
   * one it went and asked for. `honestReading` builds it from the deferred
   * outcome's own `proposed`, which is the same value from the other direction.
   */
  standing?: CorrectionProposal | null;
}) {
  const [putDown, setPutDown] = useState(false);
  const busy = corrector.busy === word;
  // A proposal belongs to the card that asked for it, and to no other: one word
  // can sit on two Rhyme Keys' cards at once, and a proposal aimed at one of
  // them is not an answer about the other.
  const mine =
    corrector.proposal !== null &&
    corrector.proposal.word === word &&
    corrector.proposal.target === rhymeKey
      ? corrector.proposal
      : null;
  const landed =
    corrector.result !== null && corrector.result.word === word ? corrector.result : null;
  // A proposal the card was handed stands in for one it asked for, and a fresh
  // ask supersedes it: the editor who asked for a second opinion is judging the
  // second one.
  const shown = mine ?? (putDown ? null : standing);

  return (
    <div className="editor-correction">
      {ask !== undefined && shown === null && landed === null && (
        <button
          type="button"
          className="editor-correction-ask"
          disabled={busy}
          onClick={() => void corrector.propose(word, rhymeKey)}
        >
          {busy ? "Asking the agent…" : ask}
        </button>
      )}

      {shown !== null && shown.outcome === "agent-unavailable" && (
        <p className="editor-correction-missed">
          The agent did not answer, and nothing was written. Ask again — a tooling failure costs a
          word, not the evening.
        </p>
      )}

      {shown !== null && shown.outcome === "nothing-to-correct" && (
        <p className="editor-correction-missed">
          {shown.rhymesDirectly
            ? "There is nothing to correct: the engine already reads this word on this Rhyme Key."
            : "There is nothing to correct: the engine holds no reading for this word at all, which is an add rather than a correction."}
        </p>
      )}

      {shown !== null && shown.outcome === "proposed" && (
        <Proposal
          proposal={shown}
          current={current}
          corrector={corrector}
          busy={busy}
          putDown={() => {
            setPutDown(true);
            corrector.dismiss();
          }}
        />
      )}

      {landed !== null && <Landed result={landed} />}

      {corrector.error !== null && busy === false && shown === null && landed === null && (
        <p className="editor-write-failed">{corrector.error}</p>
      )}
    </div>
  );
}

/**
 * The proposal, beside the engine's own reading, with the two approvals under
 * it.
 *
 * The two readings are drawn as one table rather than two paragraphs, because
 * what is being judged is the *difference* between them and a reader comparing
 * two ARPAbet strings needs them aligned. Each carries its Rhyme Key, which is
 * the thing that actually decides the verdict, and the proposal carries its
 * respelling as well — the phonemes say what the engine will do and the
 * respelling says what it will sound like, and an editor approving a stress
 * change needs both.
 */
function Proposal({
  proposal,
  current,
  corrector,
  busy,
  putDown,
}: {
  proposal: CorrectionProposal;
  current: ReadingEvidence[];
  corrector: Corrector;
  busy: boolean;
  /** Walk away. Nothing was written, which is what makes asking free. */
  putDown: () => void;
}) {
  const modes = correctionModes(current);
  return (
    <div className="editor-correction-proposal">
      <dl className="editor-correction-beside">
        <dt>The engine reads</dt>
        <dd>
          {current.length === 0 ? (
            <span className="editor-muted">nothing — the pinned sources have no reading.</span>
          ) : (
            current.map((reading) => (
              <code key={reading.phonemes.join(" ")}>
                {reading.phonemes.join(" ")} → {reading.key ?? "unstressed"}
              </code>
            ))
          )}
        </dd>
        <dt>The agent proposes</dt>
        <dd>
          <code>
            {proposal.phonemes.join(" ")} → {proposal.key ?? "unstressed"}
          </code>{" "}
          <span className="editor-correction-respelling">{proposal.respelling}</span>
        </dd>
      </dl>

      <p className={proposal.reaches ? "editor-correction-reaches" : "editor-correction-misses"}>
        {proposal.reaches ? (
          <>
            This reaches <code>{proposal.target}</code> — the Candidate's own Rhyme Key. Approving
            it makes the word rhyme.
          </>
        ) : (
          <>
            This does <strong>not</strong> reach <code>{proposal.target}</code>. If it is the
            word's honest reading, approving it is the Decline: the player is then told the word
            does not rhyme rather than that it is not a word we know.
          </>
        )}
      </p>

      {/* The reach of a correction, before either button rather than in the
          banner afterwards. It is what distinguishes this from an add. */}
      <p className="editor-correction-reach">{CORRECTION_REACH}</p>

      {modes.map((mode) => (
        <p key={mode} className={`editor-correction-mode editor-correction-mode-${mode}`}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void corrector.approve(proposal.word, proposal.target, proposal.phonemes, mode)
            }
          >
            {CORRECTION_MODE_LABEL[mode]}
          </button>{" "}
          <span className="editor-correction-consequence">
            {CORRECTION_MODE_CONSEQUENCE[mode]}
          </span>
        </p>
      ))}

      <button
        type="button"
        className="editor-correction-cancel"
        disabled={busy}
        onClick={putDown}
      >
        Leave the reading as it is
      </button>
    </div>
  );
}

/**
 * What an approved correction came to: the lines written, and the days on the
 * union of the word's Rhyme Keys before and after.
 *
 * Every day the recheck reached is named, and the ones that moved are said
 * again with their figures. A day that did not move is worth naming once —
 * "this was checked and is unchanged" is the answer to the question the warning
 * above raised, and leaving it out would make silence mean two things.
 */
function Landed({ result }: { result: CorrectionWriteResult }) {
  const moved = movedDays(result);
  return (
    <div className="editor-correction-landed">
      <p>
        Wrote {result.written.length === 1 ? "one reading" : `${result.written.length} readings`} to{" "}
        <code>data/supplement.dict</code>
        {result.mode === "join" ? ", as alternates the parser merges into one set" : ""}:{" "}
        {result.written.map((phonemes) => (
          <code key={phonemes.join(" ")}>{phonemes.join(" ")}</code>
        ))}
      </p>
      <p className="editor-muted">
        Rhyme {result.keysBefore.length === 1 ? "Key" : "Keys"}{" "}
        {result.keysBefore.join(", ") || "none"} → {result.keysAfter.join(", ") || "none"}.
        Rechecked {result.rechecked.length} {result.rechecked.length === 1 ? "key" : "keys"} over{" "}
        {result.days.length} scheduled {result.days.length === 1 ? "day" : "days"}.
      </p>

      {!result.rebuilt.ok && (
        <p className="editor-write-failed">
          The reading is written, but the Rhyme Index did not rebuild, so the figures below are
          the artifact as it was: {result.rebuilt.error}
        </p>
      )}

      {result.days.length === 0 && (
        <p className="editor-muted">
          No scheduled day sits on either Rhyme Key, so no Daily Puzzle moved.
        </p>
      )}

      {result.days.length > 0 && moved.length === 0 && (
        <p className="editor-muted">
          {result.days.map((day) => day.date).join(", ")} rechecked — nothing moved.
        </p>
      )}

      {moved.map((day) => (
        <p key={day.date} className="editor-correction-moved">
          <strong>{day.date}</strong> ({day.seed}, <code>{day.rhymeKey}</code>):{" "}
          {day.heldBefore !== day.heldAfter && (
            <>
              {result.word} {day.heldAfter ? "is now in the Puzzle" : "has left the Puzzle"}.{" "}
            </>
          )}
          {day.before !== null && day.after !== null && (
            <>
              {day.before.answerCount} → {day.after.answerCount} Answers, max Score{" "}
              {day.before.maxScore} → {day.after.maxScore}, Difficulty{" "}
              {day.before.difficulty.toFixed(2)} → {day.after.difficulty.toFixed(2)}.
            </>
          )}
        </p>
      ))}
    </div>
  );
}
