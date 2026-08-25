/**
 * The pasted rhyme list panel: a box to paste into, and what the day makes of
 * what was pasted.
 *
 * The editor already has a third-party rhyme list open in another window,
 * queried for one Rhyme Key. This is where it goes. Everything the day already
 * covers collapses to a count — that is the by-eye scan, replaced — and what is
 * left is shown as a plain list.
 *
 * **The list is not a verdict and the panel says so.** A residue word may have
 * no wordhood, no reading, or no rhyme on our own pronunciation; on the measured
 * `idiotic` day, 239 of 274 pasted words were words the index refuses. Splitting
 * that pile into the words we have never heard of and the words we know
 * perfectly well and cannot pronounce is the next slice's (#189), and it is most
 * of what this feature is finally for. Until then the panel offers no action, so
 * there is nothing here an editor can do by mistake.
 *
 * It works against **one Rhyme Key at a time** — the day's, named at the top —
 * because that is how the list on the other screen was queried. Changing the day
 * with the date control re-joins the same paste against the new day rather than
 * clearing it.
 *
 * No tests, for `usePastedList`'s reason: the join is where every rule lives and
 * it is tested over literals, leaving this a render of what that returned.
 */

import type { DayReadout } from "../../../scripts/editorDay.ts";
import type { Paste } from "./usePastedList.ts";

export function PastedListView({
  readout,
  paste,
}: {
  readout: DayReadout | null;
  paste: Paste;
}) {
  const day = readout !== null && readout.outcome === "day" ? readout : null;
  const { pasted, covered, residue } = paste.list;

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

          <section className="editor-list">
            <h3>
              Not in the day <span className="editor-muted">({residue.length})</span>
            </h3>
            {residue.length === 0 ? (
              <p className="editor-muted">
                (none — the day covers every word on the list)
              </p>
            ) : (
              <>
                <p className="editor-paste-note">
                  Nominations, not Answers: nothing here has been held against the day’s
                  Rhyme Key.
                </p>
                <ul className="editor-paste-words">
                  {residue.map((word) => (
                    <li key={word}>{word}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
