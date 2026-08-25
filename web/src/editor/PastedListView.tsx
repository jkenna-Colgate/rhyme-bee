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
 * **Still read-only.** Accepting the main pile in bulk is #190, demoting the
 * names-and-non-words pile is #191, and acting on what the day has and the list omits is
 * #192. Nothing on this screen writes anything, so there is nothing here an
 * editor can do by mistake.
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

import type { DayReadout } from "../../../scripts/editorDay.ts";
import type { DemotableWord, ReadsElsewhereWord, WordWithoutReading } from "./pastedList.ts";
import type { Paste } from "./usePastedList.ts";

/** Knownness as the readout shows it, and what an absent row is called. */
function knownnessLabel(knownness: number | null): string {
  return knownness === null ? "no prevalence row" : knownness.toFixed(2);
}

export function PastedListView({
  readout,
  paste,
}: {
  readout: DayReadout | null;
  paste: Paste;
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
              <WithoutReadingPile words={buckets.withoutReading} />
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
 * The main pile: words the game admits and cannot pronounce, best known first.
 *
 * This is where the value is. A word with **no prevalence row** is here too,
 * ordered last rather than dropped — it already resolves to a Bonus Word in the
 * Rhyme Index, and filtering on knownness would hide exactly the finds a player
 * digs for.
 */
function WithoutReadingPile({ words }: { words: readonly WordWithoutReading[] }) {
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
              </li>
            ))}
          </ul>
        </>
      )}
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
