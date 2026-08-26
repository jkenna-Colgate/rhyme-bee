/**
 * The pasted rhyme list panel: a box to paste into, and what the day makes of
 * what was pasted.
 *
 * The editor already has a third-party rhyme list open in another window,
 * queried for one Rhyme Key. This is where it goes. Everything the day already
 * covers collapses to a count — that is the by-eye scan, replaced — and what is
 * left is split on **wordhood**, best known first (#189).
 *
 * **The list is not a verdict and the panel says so.** A residue word may have
 * no wordhood, no reading, or no rhyme on our own pronunciation; on the measured
 * `idiotic` day, 239 of 274 pasted words were words the index refuses. What the
 * split is for is that those 239 are two unrelated piles — words we have never
 * heard of, and words we know perfectly well and cannot pronounce — because the
 * Rhyme Index rejects a word with no reading as `not-a-known-word` either way.
 * 197 of them turned out to have wordhood.
 *
 * **The main pile is acted on, in one gesture** (#190): everything with wordhood
 * goes to the add route in a single request, because one request is one append
 * to `data/supplement.dict`, one rebuild of the Rhyme Index and one re-read of
 * the day. Chunking the measured day's 197 words to fit a narrower bound would
 * have been four of each to do one night's work, so there is no chunking and no
 * cap here — the editor decides the volume by what they paste.
 *
 * **The names-and-non-words pile is acted on per word** (#191), and the two
 * halves of it act differently. A name the word list still holds is demoted
 * through the existing demote route, which appends to `data/demotions.txt` and
 * so survives a fresh clone; a word with no wordhood is dismissed from the
 * screen and nothing is written, because the engine already rejects it and a
 * demotion would be stale on arrival. That is a per-word gesture and not a bulk
 * one, because the reason is what the player receives and the editor picks it.
 *
 * The remaining pile is still read-only: acting on what the day has and the
 * list omits is #192.
 *
 * **There is no Tier control, and there is not meant to be one.** Tier follows
 * knownness (ADR-0003, ADR-0015); knownness is shown because it says which words
 * will actually move a player's Score and Rank, and it orders the pile for
 * exactly that reason. It is never a thing to set.
 *
 * It works against **one Rhyme Key at a time** — the day's, named at the top —
 * because that is how the list on the other screen was queried, and because
 * composition is aimed at one key and never a set (ADR-0014). Changing the day
 * with the date control re-joins the same paste against the new day rather than
 * clearing it.
 *
 * No tests, for `usePastedList`'s reason: the join is where every rule lives and
 * it is tested over literals, leaving this a render of what that returned.
 */

import { DEMOTION_REASONS, type DemotionReason } from "../../../src/demotions.ts";
import type { DayReadout, ScheduledDayReadout } from "../../../scripts/editorDay.ts";
import { DEMOTION_LABEL, DEMOTION_TITLE } from "./demote.ts";
import { InFlight } from "./InFlight.tsx";
import {
  pileToAccept,
  type DemotableWord,
  type OursNotTheirsWord,
  type ReadsElsewhereWord,
  type WordWithoutReading,
} from "./pastedList.ts";
import type { Adder } from "./useAdder.ts";
import type { Demoter } from "./useDemoter.ts";
import type { Paste } from "./usePastedList.ts";

/** Knownness as the readout shows it, and what an absent row is called. */
function knownnessLabel(knownness: number | null): string {
  return knownness === null ? "no prevalence row" : knownness.toFixed(2);
}

export function PastedListView({
  readout,
  paste,
  adder,
  demoter,
}: {
  readout: DayReadout | null;
  paste: Paste;
  adder: Adder;
  demoter: Demoter;
}) {
  const day = readout !== null && readout.outcome === "day" ? readout : null;
  const { pasted, covered, residue, buckets } = paste.list;

  return (
    <div className="editor-paste">
      {day === null ? (
        // Not an alarm: the date control is right above, and a paste typed
        // against no day is still in the box when one arrives.
        <p className="editor-muted">
          No day on screen to match a list against. Pick a scheduled date above.
        </p>
      ) : (
        <p className="editor-paste-aim">
          Matching against <strong>{day.seed}</strong> —{" "}
          <code className="editor-key">{day.rhymeKey}</code>. Query your rhyme list for that
          word, and paste what it gives you.
        </p>
      )}

      <label className="editor-paste-box">
        <span>Third-party rhyme list</span>
        <textarea
          value={paste.text}
          rows={6}
          spellCheck={false}
          placeholder={"One word per line, or comma-separated.\nPaste as much as you like."}
          onChange={(event) => paste.setText(event.target.value)}
        />
      </label>

      {/* The one failure the parse cannot make quiet. Entries are separated by
          newlines, commas and tabs and never by spaces, which is what keeps a
          phrase detectable (`pastedList.ts`) — but it means a list copied
          space-separated arrives as one enormous entry, fails the word shape,
          and is dropped in full. Silently, that is a box with text in it and
          nothing underneath, which reads as the tool being broken rather than as
          the paste being shaped wrong. */}
      {paste.text.trim() !== "" && pasted === 0 && (
        <p className="editor-paste-unread">
          Nothing in that paste looked like a word. Entries are read one per line or
          separated by commas — a list of words separated by spaces reads as a single
          phrase, and phrases are dropped.
        </p>
      )}

      {day !== null && pasted > 0 && (
        <>
          <p className="editor-paste-covered">
            <strong>{covered}</strong> of {pasted} already covered by the day — as Answers or
            as Bonus Words.
          </p>

          {residue.length === 0 && (
            <p className="editor-muted">The day covers every word on the list.</p>
          )}

          {buckets === null ? (
            <ResidueUnlooked paste={paste} />
          ) : (
            <>
              {/* First, per #186's bucket order, and quieter than the rest: it
                  is small, it is read-only, and nothing in it is work. */}
              <OursNotTheirsPile words={buckets.oursNotTheirs} />
              <WithoutReadingPile
                words={buckets.withoutReading}
                refused={paste.refused}
                day={day}
                adder={adder}
              />
              <ReadsElsewherePile words={buckets.readsElsewhere} />
              <DemotablePile
                words={buckets.demotable}
                demoter={demoter}
                onDismiss={paste.dismiss}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The residue before anyone has asked what is in it, which is a state and not a
 * failure — and the button that asks.
 *
 * A gesture rather than an effect, for the reason `usePastedList.ts` gives: the
 * far end parses `data/cmudict.dict` per request, so a lookup keyed on the
 * residue would run it once per character typed. The words are listed underneath
 * because a residue is worth seeing whether or not it has been split.
 */
function ResidueUnlooked({ paste }: { paste: Paste }) {
  const { residue, lookup } = paste.list;

  // A paste that covers the whole day and adds nothing to it leaves the lookup
  // with nothing to ask about, and the line above has already said so.
  if (lookup.length === 0) return null;

  return (
    <section className="editor-list">
      {residue.length > 0 && (
        <h3>
          Not in the day <span className="editor-muted">({residue.length})</span>
        </h3>
      )}
      <p className="editor-paste-note">
        {residue.length > 0 &&
          "Nominations, not Answers: nothing here has been held against the day’s Rhyme Key. "}
        The lookup reads the day’s own Answers back as well, so it can show which of them
        the list leaves out.
      </p>
      <p>
        <button type="button" onClick={() => void paste.look()} disabled={paste.looking}>
          {paste.looking ? "Looking…" : `Look up ${lookup.length} words`}
        </button>
      </p>
      {paste.error !== null && <p className="editor-error">{paste.error}</p>}
      <ul className="editor-paste-words">
        {residue.map((word) => (
          <li key={word}>{word}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The main pile: words the game admits and cannot pronounce, best known first —
 * and the one gesture that accepts the lot.
 *
 * This is where the value is. A word with **no prevalence row** is here too,
 * ordered last rather than dropped — it already resolves to a Bonus Word in the
 * Rhyme Index, and filtering on knownness would hide exactly the finds a player
 * digs for.
 *
 * ## One button, the whole pile
 *
 * Not one button per word. The measured `idiotic` day left 197 words here and
 * composition resolves close to none of them, so a per-word screen would render
 * 197 rows and act on almost none. Nor is it chunked: the batch goes in **one**
 * request, because that is one append, one rebuild and one re-read, and four
 * fifty-word chunks would be four of each. The bound that remains is a transport
 * bound at the route (`MAX_SUBMITTED_WORDS`), which the editor is not expected to
 * meet.
 *
 * What the batch does per word is the add route's own business and is unchanged:
 * a word a compound split reaches is written with no round trip, and every other
 * one is asked of an agent and recorded as deferred if it comes back with
 * nothing. Either way the miss is countable rather than silently lost.
 *
 * ## What the button does not carry
 *
 * A word whose sourced reading came back **refused** — the agent proposed a
 * pronunciation and `verifyReading` found it did not land on the day's key. That
 * word is marked in place with what was proposed, respelled, and gets a retry of
 * its own. Sweeping it into the next accept-all would ask the same question and
 * get the same answer with nobody looking, which is the one thing in this pile
 * that genuinely needs the editor's eye.
 *
 * **Still no Tier control.** The editor accepts words, never a Tier: which of the
 * two an accepted word lands in follows its knownness on its own (ADR-0003,
 * ADR-0015), and it is settled at the rebuild rather than here.
 */
function WithoutReadingPile({
  words,
  refused,
  day,
  adder,
}: {
  words: readonly WordWithoutReading[];
  /**
   * Every reading a request has sourced for this key and could not use, over the
   * whole sitting. Handed down from `usePastedList` rather than read off the
   * outcome here, because one outcome is on the hook at a time and a mark read
   * from there would last exactly one request (`mergeRefusals`).
   */
  refused: ReadonlyMap<string, string>;
  day: ScheduledDayReadout;
  adder: Adder;
}) {
  const batch = pileToAccept(words, refused);

  return (
    <section className="editor-list">
      <h3>
        Has wordhood, no reading <span className="editor-muted">({words.length})</span>
      </h3>
      {words.length === 0 ? (
        <p className="editor-muted">(none — nothing on the list is a word we cannot read)</p>
      ) : (
        <>
          <p className="editor-paste-note">
            Best known first. Knownness orders this pile and never shortens it, and the
            Answer/Bonus Word split follows it on its own.
          </p>

          <div className="editor-paste-accept">
            <button
              type="button"
              // Disabled on any batch in flight, this panel's or the day tab's:
              // both write the same file and run the same rebuild.
              disabled={adder.inFlight !== null || batch.words.length === 0}
              onClick={() => void adder.accept(batch.words, day.date)}
            >
              {adder.inFlight === "pasted"
                ? "Accepting…"
                : `Accept these ${batch.words.length} words`}
            </button>
            <p className="editor-paste-note">
              One request, one rebuild, one re-read.{" "}
              {batch.composes === 0
                ? "None of them composes from a compound split, so each one is asked of an agent."
                : `${batch.composes} of them compose from a compound split and are written straight away; the rest are asked of an agent.`}{" "}
              An accepted word applies to every Puzzle it appears in, not only this day.
            </p>
          </div>

          {adder.inFlight === "pasted" && (
            <AcceptInFlight count={batch.words.length} elapsedMs={adder.elapsedMs} />
          )}
          {/* This panel's own failures. A Submit refused on the day tab is about
              a queue that is not here, and its sentence ends "The queue is
              kept" — read under the pasted pile that is a report about the
              wrong words. */}
          {adder.submitError?.from === "pasted" && (
            <p className="editor-error">{adder.submitError.message}</p>
          )}

          <ul className="editor-paste-rows">
            {words.map((entry) => {
              // Read once and narrowed on, rather than asked twice and asserted:
              // `has` then `get` is a claim to the compiler that the map did not
              // move between the two calls.
              const proposed = refused.get(entry.word);
              return (
                <li key={entry.word}>
                  <span className="editor-paste-word">{entry.word}</span>
                  <span className="editor-muted">{knownnessLabel(entry.knownness)}</span>
                  {entry.composed !== null && (
                    <span className="editor-paste-composed">
                      composes: {entry.composed.head.word} + {entry.composed.tail.word}
                    </span>
                  )}
                  {proposed !== undefined && (
                    <Refused word={entry.word} proposed={proposed} day={day} adder={adder} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * A word an agent authored a reading for that the verification refused.
 *
 * Shown rather than swallowed, because the alternative is a word that quietly
 * does nothing every time the pile is accepted — the editor would learn that a
 * nomination was wrong only by noticing it had never moved. The proposal is
 * respelled so the disagreement can be read without decoding ARPAbet: the key
 * the day wants is at the top of the panel, and what was proposed is here.
 *
 * The retry is the same accept, aimed at one word. It is offered because the
 * agent is not deterministic and a second ask can land — and it is per-word
 * precisely so that asking again is something the editor decided rather than
 * something the bulk button did on their behalf.
 */
function Refused({
  word,
  proposed,
  day,
  adder,
}: {
  word: string;
  proposed: string;
  day: ScheduledDayReadout;
  adder: Adder;
}) {
  return (
    <span className="editor-paste-refused">
      the reading sourced for it was <strong>{proposed}</strong>, which is not{" "}
      <code className="editor-key">{day.rhymeKey}</code> — held back from the bulk accept.{" "}
      <button
        type="button"
        disabled={adder.inFlight !== null}
        onClick={() => void adder.accept([word], day.date)}
      >
        Ask again for {word}
      </button>
    </span>
  );
}

/**
 * What an accept shows while it runs: the shared shell, with this gesture's own
 * two clauses.
 *
 * `AddQueueView`'s `SubmitInFlight` fills the same shell differently, and the
 * difference is deliberate: a pasted pile is words the editor never typed, its
 * worst case is hours rather than minutes, and the count is worth naming because
 * it is not the list under the button. So what this one says is that walking
 * away is safe — which a fifty-word Submit does not have to promise.
 */
function AcceptInFlight({ count, elapsedMs }: { count: number; elapsedMs: number }) {
  return (
    <InFlight
      count={count}
      elapsedMs={elapsedMs}
      doing={
        <>
          sourcing readings for {count} {count === 1 ? "word" : "words"}, then rebuilding the
          Rhyme Index
        </>
      }
      leaving="It is safe to leave it: every word is written or recorded as deferred, and the paste is still here when it finishes."
    />
  );
}

/**
 * The one bucket that runs the other way: day **Answers** the pasted list leaves
 * out, each with our own reading respelled so the disagreement can be read
 * rather than decoded (#192).
 *
 * **Read-only, and framed neutrally on purpose.** A third party omitting a word
 * we serve is *sometimes* a signal that our reading is wrong and sometimes just
 * an omission, and nothing on this screen can tell which — so the bucket offers
 * no accept, no dismiss and no correction, and says nothing that would present
 * their omission as proof we are wrong. Acting on it is out of scope for #186 in
 * any case: changing a reading we already hold is a pronunciation correction
 * rather than an add, and has no door from here.
 *
 * The respellings are computed in the browser from the readings the evidence
 * seam carries, because `DayWord` deliberately holds neither a pronunciation nor
 * a respelling — the day readout omits them so a two-hundred-word payload stays
 * cheap enough to re-read on every Submit.
 *
 * Small — three on the measured `idiotic` day — and quieter than the piles under
 * it, because nothing in it is work.
 */
function OursNotTheirsPile({ words }: { words: readonly OursNotTheirsWord[] }) {
  if (words.length === 0) return null;

  return (
    <section className="editor-list editor-paste-aside">
      <h3>
        On our list, not on theirs <span className="editor-muted">({words.length})</span>
      </h3>
      <p className="editor-paste-note">
        Answers the day serves that the pasted list leaves out, and how we read them. A
        rhyme list omits words for its own reasons — this is here to be read, not acted
        on.
      </p>
      <ul className="editor-paste-rows">
        {words.map((entry) => (
          <li key={entry.word}>
            <span className="editor-paste-word">{entry.word}</span>
            {entry.readings.map((reading) => (
              <span key={reading.respelling} className="editor-muted">
                {reading.respelling} —{" "}
                <code className="editor-key">{reading.key ?? "unstressed"}</code>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Words we already read, on some key other than the day's — so the third party
 * and our own pronunciation disagree.
 *
 * Read-only, and shown respelled so the disagreement can be read rather than
 * decoded. Not in the main pile because that pile is words with *no* reading,
 * and an add for a word that already reads is a **pronunciation correction**:
 * a bigger claim, with its own door and its own deliberation.
 */
function ReadsElsewherePile({ words }: { words: readonly ReadsElsewhereWord[] }) {
  if (words.length === 0) return null;

  return (
    <section className="editor-list">
      <h3>
        We read these differently <span className="editor-muted">({words.length})</span>
      </h3>
      <p className="editor-paste-note">
        On the list, and words we already read — just not onto this Rhyme Key. Changing a
        reading we hold is a pronunciation correction rather than an add, and is not done
        from here.
      </p>
      <ul className="editor-paste-rows">
        {words.map((entry) => (
          <li key={entry.word}>
            <span className="editor-paste-word">{entry.word}</span>
            {entry.readings.map((reading) => (
              <span key={reading.respelling} className="editor-muted">
                {reading.respelling} — <code className="editor-key">{reading.key ?? "unstressed"}</code>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Names and junk: what the game should not serve, and the two gestures that take
 * them off the list for good.
 *
 * Shown with the rejection a player would receive, because that is what a
 * demotion records — `Kate` obviously rhymes with `ate`, and a refusal that does
 * not say "that is a name" reads as a bug.
 *
 * A name is here even when the word list holds it, and `pastedList.ts` argues
 * why: the evidence applies no demotions, so a name nobody has demoted yet reads
 * as having wordhood and is being served as an ordinary Answer today. The cost
 * is `bill` and `mark`, which the editor looks at and leaves alone.
 *
 * ## Why the two halves are different gestures
 *
 * Because only one of them has anything to write. A name the word list holds is
 * served today, so demoting it changes what the engine does and belongs in the
 * committed file. A word the list does not hold is already rejected, so a
 * demotion for it would be **stale on arrival** — a no-op line in a
 * hand-curated file, and enough of them would turn `data/demotions.txt` from a
 * record of corrections into a log of everything a third party ever listed. The
 * measured `idiotic` day would have contributed 197 of them in one paste.
 *
 * Neither half is a bulk gesture, and that is not an oversight: the reason is
 * the sentence the player receives, and #186 is explicit that per-word attention
 * is reserved for the cases that genuinely need judgement. This is one — the
 * pile's own test is name-hood against a list of first names, so it is right
 * about `algiers` and wrong about `bill`.
 *
 * Nothing reports here. A demotion is raised from three panels now and reaches
 * the editor above the tab strip either way (`DemoteBanner`), which is where a
 * fact about every day belongs rather than under the pile it was clicked on.
 */
function DemotablePile({
  words,
  demoter,
  onDismiss,
}: {
  words: readonly DemotableWord[];
  demoter: Demoter;
  onDismiss: (word: string) => void;
}) {
  if (words.length === 0) return null;

  return (
    <section className="editor-list">
      <h3>
        Names and non-words <span className="editor-muted">({words.length})</span>
      </h3>
      <p className="editor-paste-note">
        Not words of the game, with the rejection a player would get. A name the word list
        still holds is demoted on every day, not just this one — that is the correction
        worth making. A word the list does not hold is already refused, so dismissing it
        writes nothing and only clears the row.
      </p>
      <ul className="editor-paste-rows">
        {words.map((entry) => (
          <li key={entry.word}>
            <span className="editor-paste-word">{entry.word}</span>
            <span className="editor-muted">{entry.reason}</span>
            {entry.writes ? (
              <DemoteChoice word={entry.word} demoter={demoter} />
            ) : (
              <button
                type="button"
                className="editor-demote-reason editor-paste-dismiss"
                title="Not in the word list, so the engine already rejects it. Clears the row; writes nothing."
                onClick={() => onDismiss(entry.word)}
              >
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The demote gesture for one pasted name, with the reason chosen rather than
 * assumed.
 *
 * The same two peer buttons the day panel offers, from the same labels, for the
 * same reason: that column *is* the rejection the player receives, so it cannot
 * be defaulted — a name that rhymes must be told it is a name, and calling an
 * abbreviation somebody's name would be its own small lie. The pile's guess is
 * printed beside the word as a label and stops there.
 *
 * Disabled while any demotion is in flight rather than only this word's: they
 * all append to one file, and the row goes away by itself when the refreshed
 * demotion list reaches the join.
 */
function DemoteChoice({ word, demoter }: { word: string; demoter: Demoter }) {
  // One sentence for the row rather than "Demoting…" on both buttons, which
  // would read as two writes going out for one click.
  if (demoter.writing === word) return <span className="editor-muted">Demoting…</span>;

  return (
    <span className="editor-paste-demote" role="group" aria-label={`Demote ${word}`}>
      {DEMOTION_REASONS.map((reason: DemotionReason) => (
        <button
          type="button"
          key={reason}
          className="editor-demote-reason"
          title={DEMOTION_TITLE[reason]}
          disabled={demoter.writing !== null}
          onClick={() => void demoter.demote(word, reason)}
        >
          {DEMOTION_LABEL[reason]}
        </button>
      ))}
    </span>
  );
}
