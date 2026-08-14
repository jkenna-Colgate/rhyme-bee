/**
 * The standing **Declines**: the editor's ruling that a Candidate should not
 * become an Answer, recorded against the word and the Rhyme Key *together*.
 *
 * A Candidate's state is otherwise derived — a word that rhymes on its Rhyme Key
 * against the current Rhyme Index is resolved by that fact alone, and nothing is
 * written for it (#176). A Decline is the one thing written, and only for the
 * one case that leaves no trace anywhere else: the editor read the Candidate,
 * agreed with the rejection the player already received, and wants it to stop
 * appearing. The other two rulings — a Proper Noun, and junk with wordhood —
 * are **demotions**, and `src/demotions.ts` already records them in the file
 * whose second column is the message the player gets.
 *
 * ## Why it does not share a module with demotions
 *
 * A demotion changes adjudication: it withdraws wordhood, and the player's next
 * Submission of that word is refused differently because of it. A Decline
 * changes nothing at all — no verdict, no Puzzle, no figure — and exists only so
 * a queue an editor has worked stops re-presenting itself. Two files with
 * opposite reach must be free to vary apart, and a shared module is the thing
 * that stops them.
 *
 * ## Why the key is the pair
 *
 * `docked` was Appealed against `AA K T` and could be Appealed tomorrow against
 * `AA K` by a player who heard it differently. Declining the first must not hide
 * the second: the ruling is about a word *aimed at a target*, which is what a
 * Candidate is, and a Decline keyed on the word alone would silently answer a
 * question nobody had asked yet.
 *
 * ## The format
 *
 * One Decline per line, the word first and the Rhyme Key filling the rest of the
 * line, `#` comments and blanks ignored:
 *
 *     docked AA K T          # heard as a rhyme for `dock`; the reading is right
 *     lbs    AH B AH L
 *
 * The key runs to the end of the line rather than being a second whitespace-
 * separated column, because a Rhyme Key *contains* spaces (`AA K T`) and a
 * two-column split on whitespace could not read one back.
 *
 * A malformed line is **dropped rather than thrown over**, which is the opposite
 * of `parseDemotions` and is the reach argument again: a dropped demotion serves
 * a name to a player as an ordinary Answer, so that file must fail loudly. A
 * dropped Decline costs one Candidate reappearing on a screen only the editor
 * sees, and refusing to read the file at all would cost every one of them.
 */

import { normaliseWord } from "./cmudict.ts";
import type { RhymeKey } from "./phonology.ts";

/** One standing ruling: this word, aimed at this Rhyme Key, is not an Answer. */
export interface Decline {
  word: string;
  rhymeKey: RhymeKey;
}

/** Space-separated ARPABET with the stress digits stripped, as `rhymeKeyOf` emits. */
const RHYME_KEY_SHAPE = /^[A-Z]+( [A-Z]+)*$/;

/**
 * True when `value` is spelled like a Rhyme Key.
 *
 * Exported so the parser below and the write route's validator
 * (`web/editorDeclineRequest.ts`) check against one pattern rather than two
 * copies of it — the shape `isDemotionReason` takes in `src/demotions.ts`, for
 * the same reason: a key the route accepts and the parser then drops would be a
 * ruling the editor watched land and that never came back.
 *
 * It is a check on the *spelling*, not on the key existing anywhere. Whether any
 * Puzzle is dealt on it is a question about `data/schedule.json`, and a Decline
 * is aimed at whatever key the Candidate named.
 */
export function isRhymeKeyShape(value: string): value is RhymeKey {
  return RHYME_KEY_SHAPE.test(value);
}

/**
 * The lookup key for one ruling: the word and the Rhyme Key together, in one
 * string, so a `Set` answers "is this Candidate declined" in one question.
 *
 * Written here rather than at the call site because "keyed on the pair" is the
 * decision this module exists to hold, and a caller that built the string itself
 * would be a second place that had to keep agreeing with it. The separator is a
 * tab: a Rhyme Key holds spaces and a word holds letters, so neither side can
 * contain one and no pair can be spelled two ways.
 */
export function declineKey(word: string, rhymeKey: RhymeKey): string {
  return `${normaliseWord(word)}\t${rhymeKey.trim()}`;
}

/** The standing rulings as one lookup, for `declineKey`'s pairs. */
export function declinedPairs(declines: readonly Decline[]): ReadonlySet<string> {
  return new Set(declines.map((d) => declineKey(d.word, d.rhymeKey)));
}

/**
 * Serialise one Decline as a single newline-terminated line, ready to append.
 * The word is normalised here rather than only on the way back in, so the file
 * receives the one spelling a Candidate will be looked up under.
 */
export function serialiseDecline(decline: Decline): string {
  return `${normaliseWord(decline.word)} ${decline.rhymeKey.trim()}\n`;
}

/**
 * Parse the Declines file. Blanks and `#` comments are skipped, and a line that
 * is not a word followed by a Rhyme Key is dropped — see the module comment for
 * why this file is forgiving where the demotion list is strict.
 */
export function parseDeclines(text: string): Decline[] {
  const out: Decline[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const cut = line.search(/\s/);
    if (cut === -1) continue;
    const word = normaliseWord(line.slice(0, cut));
    // The key is the rest of the line, collapsed: a Rhyme Key holds spaces, so
    // it cannot be a second whitespace-separated column.
    const rhymeKey = line.slice(cut + 1).trim().replace(/\s+/g, " ");
    if (word === "" || !isRhymeKeyShape(rhymeKey)) continue;
    out.push({ word, rhymeKey });
  }
  return out;
}
