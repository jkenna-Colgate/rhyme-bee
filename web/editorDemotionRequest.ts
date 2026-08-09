/**
 * What counts as a demotion, and how much of one the endpoint will read. The
 * whole of the decision with none of the transport, so the two things most worth
 * getting right about a route that **writes to `data/`** can be tested without
 * standing a dev server up — the split `editorTierRequest.ts` makes, for the
 * same reason.
 *
 * No day is named. A Tier judgement is read back against the day whose figures
 * it moves, but a demotion takes a word's **wordhood**, which is a property of
 * the word and of no date: the same word demoted from Monday's screen is gone
 * from every day that ever held it. So this route has no date parameter to get
 * wrong, and `editorDayRequest` is deliberately not asked anything here.
 */

import { isDemotionReason, DEMOTION_REASONS, type DemotionReason } from "../src/demotions.ts";
import { normaliseWord } from "../src/cmudict.ts";

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A demotion is a word and one of two fixed strings — well under a hundred
 * bytes of JSON, and the longest word in `data/words.txt` is nowhere near the
 * slack this leaves. It is sized to what the route carries rather than to what a
 * caller might send, which is the point of a cap: the alternative to one is
 * buffering whatever arrives, on a route whose next act is a write to committed
 * data.
 *
 * Its own constant rather than the Tier route's 512, on that module's own
 * reasoning: tying two caps together would mean a change to either being
 * reasoned about as a change to both, and these two bodies are different shapes.
 */
export const MAX_DEMOTION_BODY_BYTES = 512;

/**
 * Words are lower-case letters. `data/words.txt` holds 370,105 of them and every
 * one matches this, so the shape is the vocabulary's rather than a guess at it.
 *
 * Checked here even though the word arrives from a list this endpoint's sibling
 * sent, because the next thing that happens to it is a line appended to
 * committed data that the index build parses strictly — a line `parseDemotions`
 * refuses stops the build over the whole file.
 */
const WORD = /^[a-z]+$/;

export type DemotionWriteRequest =
  | { ok: true; word: string; reason: DemotionReason }
  | { ok: false; error: string };

/**
 * The demotion a request body carries.
 *
 * The reason is required and has no default, which is the ticket's rule and not
 * a validation habit: the second column is the rejection the player actually
 * receives, so a demotion that guessed it would tell a player that an
 * abbreviation is somebody's name, or refuse a name without saying it is one.
 * Defaulting to either would be a lie the format is shaped to prevent.
 *
 * The word is normalised exactly as `parseDemotions` normalises it on the way
 * back in, so an entry written from this screen withdraws wordhood from the word
 * the editor clicked and not from a near-miss of it.
 */
export function demotionWriteRequest(body: string): DemotionWriteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not a demotion." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not a demotion." };
  }

  const { word, reason } = parsed as { word?: unknown; reason?: unknown };
  if (typeof word !== "string" || !WORD.test(normaliseWord(word))) {
    return {
      ok: false,
      error: `"${String(word)}" is not a word. A demotion names one word, in letters.`,
    };
  }
  if (typeof reason !== "string" || !isDemotionReason(reason)) {
    return {
      ok: false,
      error:
        `"${String(reason)}" is not a reason. Expected one of ${DEMOTION_REASONS.join(", ")} — ` +
        "the reason is the rejection the player receives, so it is not optional.",
    };
  }

  return { ok: true, word: normaliseWord(word), reason };
}
