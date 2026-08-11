/**
 * The Candidate Queue, rendered. Two surfaces over one readout: the whole queue
 * grouped by Rhyme Key, and the panel for the day the editor is already reading
 * (#177).
 *
 * **This file decides nothing.** Every state on the screen was derived in
 * `scripts/editorCandidates.ts` and arrived over the wire already resolved; the
 * only choice made here is which card a state draws, and even that is
 * `cardFor`'s (`dayCandidates.ts`), so the day panel and the whole-queue list
 * cannot draw one Candidate two ways. If a resolved check or an
 * add-versus-correct determination ever appears in this file, the shape has gone
 * wrong.
 *
 * **Nothing here is a gesture.** Slice 1 is a read: no button writes, and no
 * click changes a file. The cards name the act each Candidate is waiting for so
 * that the editor can see the shape of the evening's work, and slices 2 to 4 are
 * what attach the acts to them.
 */

import type { ReadCandidate } from "../../../scripts/editorCandidates.ts";
import type { CandidateQueueReadout, CandidateGroup } from "../../../scripts/editorCandidates.ts";
import type { Pronunciation } from "../../../src/phonology.ts";
import { candidatesForDay, cardFor } from "./dayCandidates.ts";

/**
 * The whole queue, at the top of the pass beside the status panel.
 *
 * Drawn even when it is empty, because an empty queue and an unpulled one look
 * identical and only one of them is good news — which is what `newest` is for.
 */
export function CandidateQueueView({
  queue,
  error,
  loading,
}: {
  queue: CandidateQueueReadout | null;
  error: string | null;
  loading: boolean;
}) {
  return (
    <section className="editor-queue">
      <h2>Candidate Queue</h2>

      {error !== null && <p className="editor-queue-failed">{error}</p>}

      {queue === null && error === null && (
        <p className="editor-muted">{loading ? "Reading the queue…" : "No queue yet."}</p>
      )}

      {queue !== null && (
        <>
          <p className="editor-queue-lede">
            {queue.outstanding} of {queue.total} outstanding, over {queue.groups.length} Rhyme{" "}
            {queue.groups.length === 1 ? "Key" : "Keys"}. <Newest newest={queue.newest} />
          </p>

          {queue.groups.map((group) => (
            <QueueGroup key={group.rhymeKey} group={group} />
          ))}
        </>
      )}
    </section>
  );
}

/**
 * The queue's own newest timestamp, said in full.
 *
 * The pull from R2 stays a CLI step run before the dev server (#176), so this is
 * the only way the screen can tell an editor that the list in front of them is
 * behind: a queue nobody has pulled looks *empty*, which reads as "no work" when
 * it means "no data".
 */
function Newest({ newest }: { newest: string | null }) {
  if (newest === null) {
    return (
      <span className="editor-queue-stale">
        Nothing on the queue at all — run <code>npm run pull:appeals</code> if that is a surprise.
      </span>
    );
  }
  return (
    <span className="editor-muted">
      Newest Candidate {newest.slice(0, 10)}; run <code>npm run pull:appeals</code> for anything
      since.
    </span>
  );
}

/** One Rhyme Key's Candidates, and the day the schedule holds for that key. */
function QueueGroup({ group }: { group: CandidateGroup }) {
  return (
    <article className="editor-queue-group">
      <h3>
        <code>{group.rhymeKey}</code>{" "}
        <span className="editor-muted">
          {group.outstanding === 0
            ? "nothing outstanding"
            : `${group.outstanding} outstanding of ${group.candidates.length}`}
        </span>
      </h3>

      <p className="editor-queue-day">
        {group.day === null ? (
          // The common case, and the one a day-shaped surface would have lost:
          // an Appeal raised in Free Play carries a Seed the schedule never had.
          <span className="editor-queue-undated">No scheduled day holds this Rhyme Key.</span>
        ) : (
          <>
            {group.day.date} <span className="editor-muted">{group.day.weekday}</span> · Seed{" "}
            <strong>{group.day.seed}</strong>
          </>
        )}
        {" · "}
        Appealed against {group.seedWords.join(", ")}
      </p>

      <ul className="editor-queue-list">
        {group.candidates.map((candidate) => (
          <li key={`${candidate.word}-${candidate.candidate.timestamp}`}>
            <CandidateCardView candidate={candidate} />
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The day's own Candidates, inside the scheduled-day case and nowhere else —
 * the other two readouts have no Rhyme Key to select on.
 *
 * It draws nothing at all when the day's key holds no Candidates, which is 255
 * days out of 260. A panel that appeared on every day to say "none" would be a
 * heading the editor learns to skip, and the whole queue is one panel up.
 */
export function DayCandidatesView({
  queue,
  rhymeKey,
}: {
  queue: CandidateQueueReadout | null;
  rhymeKey: string;
}) {
  const day = candidatesForDay(queue, rhymeKey);
  if (day.all.length === 0) return null;

  return (
    <section className="editor-queue-day-panel">
      <h3>
        Candidates on this Rhyme Key{" "}
        <span className="editor-muted">
          {day.outstanding.length === 0
            ? "— all settled"
            : `— ${day.outstanding.length} outstanding of ${day.all.length}`}
        </span>
      </h3>

      {/* Worth saying whenever it is true: the panel is selected by Rhyme Key,
          so a Candidate raised on another Puzzle entirely can land here, and an
          editor reading the day's Seed Word would otherwise wonder why. */}
      {day.seedWords.length > 1 && (
        <p className="editor-queue-note">
          Raised against {day.seedWords.join(" and ")} — the same rhyme family, judged together.
        </p>
      )}

      <ul className="editor-queue-list">
        {day.all.map((candidate) => (
          <li key={`${candidate.word}-${candidate.candidate.timestamp}`}>
            <CandidateCardView candidate={candidate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the editor is told about one Candidate: its state, and its own evidence. */
function CandidateCardView({ candidate }: { candidate: ReadCandidate }) {
  return (
    <div className={`editor-candidate editor-candidate-${cardFor(candidate)}`}>
      <span className="editor-candidate-word">{candidate.word}</span>
      <span className="editor-candidate-state">{STATE_SENTENCE[candidate.state]}</span>
      <CandidateEvidence candidate={candidate} />
    </div>
  );
}

/**
 * What each state means, in the editor's terms rather than the union's.
 *
 * A `Record` over the closed set rather than a `switch` with a default: a sixth
 * state cannot be added to the union without this table refusing to compile,
 * which is the shape `REJECTION_MESSAGE` uses for the same guarantee (ADR-0005).
 */
const STATE_SENTENCE: Record<ReadCandidate["state"], string> = {
  resolved: "rhymes now — nothing to do",
  declined: "declined for this Rhyme Key",
  "is-a-name": "a name — demote it",
  "needs-correction": "reads on another key — needs a correction",
  addable: "no reading the engine will take — an add",
};

/**
 * Each card shows the evidence its own case turns on and not the rest, which is
 * what keeps the screen readable at the point of judgement. The cases cannot
 * overlap: `gatherEvidence` never offers relatives for a word that already
 * reads, so a correction has readings and a derivation has relatives.
 */
function CandidateEvidence({ candidate }: { candidate: ReadCandidate }) {
  switch (candidate.state) {
    case "declined":
    case "is-a-name":
      return null;
    case "resolved":
    case "needs-correction":
      return (
        <span className="editor-candidate-evidence">
          {candidate.readings.map((reading) => (
            <code key={reading.phonemes.join(" ")}>
              {say(reading.phonemes)} → {reading.key ?? "unstressed"}
            </code>
          ))}
        </span>
      );
    case "addable":
      return (
        <span className="editor-candidate-evidence">
          {candidate.composed !== null && (
            <code>
              {candidate.composed.head.word} + {candidate.composed.tail.word} →{" "}
              {say(candidate.composed.phonemes)}
            </code>
          )}
          {candidate.relatives.map((relative) => (
            <code key={relative.word}>
              {relative.word} {relative.readings.map((r) => r.key ?? "—").join(", ")}
            </code>
          ))}
          {candidate.readings.map((reading) => (
            <code key={reading.phonemes.join(" ")}>
              {say(reading.phonemes)} → {reading.key ?? "unstressed"} (no wordhood)
            </code>
          ))}
        </span>
      );
  }
}

function say(phonemes: Pronunciation): string {
  return phonemes.join(" ");
}
