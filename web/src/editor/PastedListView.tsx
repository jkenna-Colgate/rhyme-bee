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
 * The other two piles are still read-only: demoting the names-and-non-words pile
 * is #191, and acting on what the day has and the list omits is #192.
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

import type { DayReadout, ScheduledDayReadout } from "../../../scripts/editorDay.ts";
import { WORST_CASE_MS_PER_WORD } from "./add.ts";
import {
  pileToAccept,
  refusedReadings,
  type DemotableWord,
  type ReadsElsewhereWord,
  type WordWithoutReading,
} from "./pastedList.ts";
import type { Adder } from "./useAdder.ts";
import type { Paste } from "./usePastedList.ts";

/** Knownness as the readout shows it, and what an absent row is called. */
function knownnessLabel(knownness: number | null): string {
  return knownness === null ? "no prevalence row" : knownness.toFixed(2);
}

export function PastedListView({
  readout,
  paste,
  adder,
}: {
  readout: DayReadout | null;
  paste: Paste;
  adder: Adder;
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

          {residue.length === 0 ? (
            <p className="editor-muted">The day covers every word on the list.</p>
          ) : buckets === null ? (
            <ResidueUnlooked paste={paste} />
          ) : (
            <>
              <WithoutReadingPile words={buckets.withoutReading} day={day} adder={adder} />
              <ReadsElsewherePile words={buckets.readsElsewhere} />
              <DemotablePile words={buckets.demotable} />
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
  const { residue } = paste.list;

  return (
    <section className="editor-list">
      <h3>
        Not in the day <span className="editor-muted">({residue.length})</span>
      </h3>
      <p className="editor-paste-note">
        Nominations, not Answers: nothing here has been held against the day’s Rhyme Key.
      </p>
      <p>
        <button type="button" onClick={() => void paste.look()} disabled={paste.looking}>
          {paste.looking ? "Looking…" : `Look up these ${residue.length} words`}
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
  day,
  adder,
}: {
  words: readonly WordWithoutReading[];
  day: ScheduledDayReadout;
  adder: Adder;
}) {
  // Keyed off the day's own Rhyme Key, so an outcome from a batch raised against
  // a Candidate's key — routinely not this day's — cannot hold a word back here.
  const refused = refusedReadings(adder.result?.outcome ?? null, day.rhymeKey);
  const batch = pileToAccept(words, refused);
  const composes = words.filter(
    (entry) => entry.composed !== null && !refused.has(entry.word),
  ).length;

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
              disabled={adder.submitting || batch.length === 0}
              onClick={() => void adder.accept(batch, day.date)}
            >
              {adder.accepting ? "Accepting…" : `Accept these ${batch.length} words`}
            </button>
            <p className="editor-paste-note">
              One request, one rebuild, one re-read.{" "}
              {composes === 0
                ? "None of them composes from a compound split, so each one is asked of an agent."
                : `${composes} of them compose from a compound split and are written straight away; the rest are asked of an agent.`}{" "}
              An accepted word applies to every Puzzle it appears in, not only this day.
            </p>
          </div>

          {adder.accepting && <AcceptInFlight count={batch.length} elapsedMs={adder.elapsedMs} />}
          {adder.submitError !== null && <p className="editor-error">{adder.submitError}</p>}

          <ul className="editor-paste-rows">
            {words.map((entry) => (
              <li key={entry.word}>
                <span className="editor-paste-word">{entry.word}</span>
                <span className="editor-muted">{knownnessLabel(entry.knownness)}</span>
                {entry.composed !== null && (
                  <span className="editor-paste-composed">
                    composes: {entry.composed.head.word} + {entry.composed.tail.word}
                  </span>
                )}
                {refused.has(entry.word) && (
                  <Refused
                    word={entry.word}
                    proposed={refused.get(entry.word) as string}
                    day={day}
                    adder={adder}
                  />
                )}
              </li>
            ))}
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
      <button type="button" disabled={adder.submitting} onClick={() => void adder.accept([word], day.date)}>
        Ask again for {word}
      </button>
    </span>
  );
}

/**
 * What an accept shows while it runs.
 *
 * `AddQueueView`'s `InFlight` says the same three things for the typed queue, and
 * this is not it: the sentences differ because the batches differ. A pasted pile
 * is words the editor never typed and cannot lose by waiting, and its worst case
 * is hours rather than minutes — so what needs saying is that walking away is
 * safe, which is not something a fifty-word Submit has to promise.
 *
 * The bound is a maximum and not an estimate. A word a compound split reaches is
 * written in milliseconds and never touches an agent; quoting the typical case
 * would be the number that makes the long batch feel broken.
 */
function AcceptInFlight({ count, elapsedMs }: { count: number; elapsedMs: number }) {
  const worstCaseMinutes = Math.ceil((count * WORST_CASE_MS_PER_WORD) / 60_000);
  return (
    <p className="editor-add-inflight" role="status">
      <strong>{Math.floor(elapsedMs / 1000)}s</strong> — sourcing readings for {count}{" "}
      {count === 1 ? "word" : "words"}, then rebuilding the Rhyme Index. A word no compound split
      reaches waits on an agent for up to a minute, so this can run to {worstCaseMinutes}{" "}
      {worstCaseMinutes === 1 ? "minute" : "minutes"}. It is safe to leave it: every word is
      written or recorded as deferred, and the paste is still here when it finishes.
    </p>
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
 * Names and junk: what the game should not serve. Shown with the rejection a
 * player would receive, because that is what a demotion records — `Kate`
 * obviously rhymes with `ate`, and a refusal that does not say "that is a name"
 * reads as a bug.
 *
 * A name is here even when the word list holds it, and `pastedList.ts` argues
 * why: the evidence applies no demotions, so a name nobody has demoted yet reads
 * as having wordhood and is being served as an ordinary Answer today. The cost
 * is `bill` and `mark`, which the editor looks at and leaves alone.
 *
 * The demotion gesture itself is #191. This is the pile it will act on.
 */
function DemotablePile({ words }: { words: readonly DemotableWord[] }) {
  if (words.length === 0) return null;

  return (
    <section className="editor-list">
      <h3>
        Names and non-words <span className="editor-muted">({words.length})</span>
      </h3>
      <p className="editor-paste-note">
        Not words of the game, with the rejection a player would get. A name is listed even
        if the word list still holds it — that is the demotion worth making. Recording
        those demotions so the words stop reappearing is a later slice.
      </p>
      <ul className="editor-paste-rows">
        {words.map((entry) => (
          <li key={entry.word}>
            <span className="editor-paste-word">{entry.word}</span>
            <span className="editor-muted">{entry.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
