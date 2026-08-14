/**
 * What counts as a Decline, and how much of one the endpoint will read. The
 * whole of the decision with none of the transport, so the two things most worth
 * getting right about a route that **writes to `data/`** can be tested without
 * standing a dev server up — the split `editorDemotionRequest.ts` and
 * `editorTierRequest.ts` both make, for the same reason.
 *
 * A Rhyme Key *is* named here, unlike on the demotion route, and that is the
 * whole difference between the two files. A demotion takes a word's wordhood,
 * which is a property of the word and of no target; a Decline is the editor's
 * ruling on a Candidate, and a Candidate is a word *aimed at* a Rhyme Key. So
 * the pair travels, and a ruling made against one target leaves the same word
 * visible when it is Appealed against another (#176).
 *
 * No day is named either, for the demotion route's reason and one more: 17 of
 * the 33 standing Candidates belong to no scheduled day at all, so a date would
 * be a field most Declines could not fill.
 *
 * The key's *spelling* is checked and its existence is not. Whether a Puzzle is
 * dealt on a key is a question about `data/schedule.json`, which this module
 * does not read, and a Decline is aimed at whatever key the Candidate named
 * whether or not the schedule ever holds one.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isRhymeKeyShape } from "../src/declines.ts";
import type { RhymeKey } from "../src/phonology.ts";

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A Decline is a word and a Rhyme Key — well under a hundred bytes of JSON, and
 * the longest key in the index is a handful of phonemes. Sized to what the route
 * carries rather than to what a caller might send, which is the point of a cap:
 * the alternative to one is buffering whatever arrives, on a route whose next
 * act is a write to committed data.
 *
 * Its own constant rather than the demotion route's 512, on that module's own
 * reasoning: tying two caps together would mean a change to either being
 * reasoned about as a change to both.
 */
export const MAX_DECLINE_BODY_BYTES = 512;

/**
 * Words are lower-case letters. `data/words.txt` holds 370,105 of them and every
 * one matches this, so the shape is the vocabulary's rather than a guess at it.
 *
 * Checked here even though the word arrives from a queue this endpoint's sibling
 * served, because the next thing that happens to it is a line appended to
 * committed data — and a line `parseDeclines` cannot read is a ruling dropped
 * silently, which is the one failure this file has no way to report.
 */
const WORD = /^[a-z]+$/;

export type DeclineWriteRequest =
  | { ok: true; word: string; rhymeKey: RhymeKey }
  | { ok: false; error: string };

/**
 * The ruling a request body carries.
 *
 * Both fields are required and neither has a default. A Decline with no key
 * would be a ruling about a word in general, which is the thing the pair exists
 * to prevent: `docked` declined against `AA K T` must stay visible when a player
 * who hears it differently Appeals it against `AA K`.
 *
 * The word is normalised exactly as `parseDeclines` normalises it on the way
 * back in, so a ruling written from this screen settles the Candidate the editor
 * clicked and not a near-miss of it.
 */
export function declineWriteRequest(body: string): DeclineWriteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not a Decline." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not a Decline." };
  }

  const { word, rhymeKey } = parsed as { word?: unknown; rhymeKey?: unknown };
  if (typeof word !== "string" || !WORD.test(normaliseWord(word))) {
    return {
      ok: false,
      error: `"${String(word)}" is not a word. A Decline names one word, in letters.`,
    };
  }
  if (typeof rhymeKey !== "string" || !isRhymeKeyShape(rhymeKey.trim())) {
    return {
      ok: false,
      error:
        `"${String(rhymeKey)}" is not a Rhyme Key. A Decline is recorded against the word and ` +
        "the key together, so that declining a word for one target does not hide it when it is " +
        "Appealed against another.",
    };
  }

  return { ok: true, word: normaliseWord(word), rhymeKey: rhymeKey.trim() };
}
