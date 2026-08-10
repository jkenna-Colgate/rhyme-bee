/**
 * A word the index already holds — on a Rhyme Key that is not this day's — and
 * the one click that records the editor's disagreement with that reading (#163).
 *
 * Its own file rather than another section of `AddQueueView.tsx`, which every
 * commit in this run has edited and which already holds the queue, the Submit
 * rule and the outcome renderer. This is none of those: it is the one
 * gesture on that screen that is not an add, it writes to a different endpoint,
 * and the argument below is about a different act. Splitting it costs one import
 * and takes the whole of that argument out of a module that has to be read to
 * change any of the other three.
 *
 * ## Why it names the keys
 *
 * "It already has a reading that does not rhyme" leaves the editor watching a
 * word they were sure about do nothing. The engine *has* a pronunciation, and
 * that pronunciation is the whole of the disagreement, so the line says where
 * the index holds the word: each reading with the key it yields. A word can be
 * held more than once, and a reading with no stressed vowel yields no key at
 * all — said in words rather than shown as a blank, because a blank beside a
 * key reads as a rendering fault.
 *
 * ## Why there is a button, and why it records rather than fixes
 *
 * The editor is reading a third-party rhyme list in the next window and believes
 * the word rhymes anyway. That belief is worth exactly as much at 11pm as it is
 * in a judging pass, and nothing else on this screen can hold it: an add wrote
 * nothing, a Tier verdict is about a word that is already in the Puzzle, and a
 * demotion takes wordhood away rather than granting a reading. So the click
 * records a **Candidate** — the report, never the fix (CONTEXT.md) — into the
 * queue that already exists for exactly this claim.
 *
 * No pronunciation is offered, proposed or accepted anywhere here, and the
 * button's words are chosen so it cannot be read as offering one. Contradicting
 * a source that spoke is a different act from filling a gap where the sources
 * are silent, with different stakes and its own evidence requirements; it stays
 * a hand edit of `data/supplement.dict`, made against the queue rather than from
 * this screen.
 *
 * ## Why it says "this pass" rather than "recorded"
 *
 * The queue cannot be read from here — it is write-only by design — so what the
 * screen actually knows is that *this tab* posted it. Saying so is the honest
 * version of the same reassurance, and it is why a reload puts the button back:
 * the record is in the queue, and the screen has simply stopped knowing it.
 *
 * ## Why a missing Seed Word gets a sentence rather than nothing
 *
 * A Candidate names the Seed Word the disagreement is about, so an aim with no
 * Puzzle behind it — the command line's `--rhymeKey`, which names a Rhyme Key
 * outright — has nothing to record against. That case used to render nothing at
 * all: the button simply was not there, leaving the editor watching a word they
 * were sure about do nothing, which is the exact failure this whole component
 * exists to prevent. It now says why. `ScheduledAddTarget`
 * (`scripts/editorAdd.ts`) is what keeps it off the browser's own path — every
 * aim `web/editorAddPlugin.ts` can build carries a Seed — but `AddOutcome.seed`
 * stays optional because the outcome is the union of both aims, so the type
 * cannot make the sentence unreachable and the screen says it plainly instead.
 */

import type { AddTarget, ReadsOnAnotherKeyOutcome } from "../../../scripts/editorAdd.ts";
import { disagreementKey, disagreementReport } from "./disagreement.ts";
import type { Disagreer } from "./useDisagreement.ts";

export function ReadsElsewhere({
  word,
  aim,
  disagreer,
}: {
  word: ReadsOnAnotherKeyOutcome;
  /**
   * The aim the batch ran against — the Rhyme Key and the Seed Word behind it —
   * taken whole rather than as two props. They are one value with a name
   * (`AddTarget`), they are read together everywhere below, and passing them
   * apart is how `outcome.seed ?? null` came to be spelled out at the call site
   * where the two were separated.
   */
  aim: AddTarget;
  disagreer: Disagreer;
}) {
  const { target } = aim;
  const seed = aim.seed ?? null;
  // Keyed on the word *and* the Seed Word: the same word against a different
  // Puzzle is a different claim, and the button has to still be offered for it.
  const recorded = seed !== null && disagreer.recorded.has(disagreementKey(word.word, seed));
  const recording = disagreer.recording === word.word;

  return (
    <>
      already reads, and not on <code>{target}</code> — so this is a correction rather than an add,
      and nothing was written. Correcting a reading an upstream source gave is not something this
      tool does. The index holds it as{" "}
      <span className="editor-muted">
        {word.readings.map((reading, at) => (
          <span key={reading.phonemes.join(" ")}>
            {at > 0 && "  ·  "}
            {reading.phonemes.join(" ")} on{" "}
            {reading.key === null ? (
              <em>no key — the reading has no stressed vowel</em>
            ) : (
              <code>{reading.key}</code>
            )}
          </span>
        ))}
      </span>
      .{" "}
      {seed === null ? (
        <span className="editor-muted">
          This batch was aimed at <code>{target}</code> directly rather than at a Puzzle, so there is
          no Seed Word to record a disagreement against. Submit the word from a scheduled day to
          record one.
        </span>
      ) : recorded ? (
        <span className="editor-disagree-recorded">
          Recorded this pass — the word, {seed} and <code>{target}</code> are in the
          supplement-candidate queue for a judging pass to rule on.
        </span>
      ) : (
        <button
          type="button"
          className="editor-disagree"
          disabled={recording}
          onClick={() => {
            void disagreer.record(disagreementReport(word.word, word.readings, seed, target));
          }}
        >
          {recording ? "Recording…" : `It does rhyme with ${seed} — record that`}
        </button>
      )}
    </>
  );
}
