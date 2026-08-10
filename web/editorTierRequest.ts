/**
 * What counts as a judgement, and how much of one the endpoint will read. The
 * whole of the decision with none of the transport, so the two things most worth
 * getting right about a route that **writes to `data/`** can be tested without
 * standing a dev server up — the split `editorDayRequest.ts` makes, for the same
 * reason.
 *
 * Which *day* the picker is asking about is not decided here: it is the same
 * question the day endpoint answers, so `editorDayRequest` answers it for both.
 * A second copy of "no date means tomorrow" would be a second place for the two
 * halves of one screen to disagree about which day they are showing.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isTierVerdict, notAVerdict, type TierVerdict } from "../src/tierOverride.ts";

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A judgement is a word and one of four fixed strings — under a hundred bytes of
 * JSON, and the longest word in `data/words.txt` is nowhere near the slack this
 * leaves. It is sized to what the route carries rather than to what a caller
 * might send, which is the point of a cap: the alternative to one is buffering
 * whatever arrives, on a route whose next action is a write to a file that can
 * never be regenerated (ADR-0015).
 *
 * Deliberately its own constant rather than the day endpoint's 512. That one is
 * the answer to "a read carries no body at all, so what happens to one that
 * arrives anyway"; this one is a real body's real size, and tying them together
 * would mean a change to either being reasoned about as a change to both.
 */
export const MAX_TIER_BODY_BYTES = 512;

/**
 * Words are lower-case letters. `data/words.txt` holds 370,105 of them and every
 * one matches this, so the shape is the vocabulary's rather than a guess at it.
 *
 * Checked here even though the word arrives from a list this endpoint itself
 * sent, because the next thing that happens to it is a line appended to a CSV.
 * `serialiseTierOverride` would quote a comma or a newline safely, so this is
 * not the file's last defence — it is the refusal that means a nonsense word
 * never reaches an append-only file in the first place.
 */
const WORD = /^[a-z]+$/;

export type TierWriteRequest =
  | { ok: true; word: string; verdict: TierVerdict }
  | { ok: false; error: string };

/**
 * The judgement a request body carries.
 *
 * The word is normalised exactly as `parseTierOverrides` normalises it on the
 * way back in, so a row written from this screen resolves to the word the editor
 * clicked and not to a near-miss of it.
 *
 * There is no `note`. The file has the column and `serialiseTierOverride` writes
 * it, but nothing on this screen collects one: recording *why* the editor
 * disagreed with the data is #163's, and a field accepted here before there is
 * anything to put in it would be a shape decided in advance of its use.
 */
export function tierWriteRequest(body: string): TierWriteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not a judgement." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not a judgement." };
  }

  const { word, verdict } = parsed as { word?: unknown; verdict?: unknown };
  if (typeof word !== "string" || !WORD.test(normaliseWord(word))) {
    return {
      ok: false,
      error: `"${String(word)}" is not a word. A judgement names one word, in letters.`,
    };
  }
  if (typeof verdict !== "string" || !isTierVerdict(verdict)) {
    return { ok: false, error: notAVerdict(String(verdict)) };
  }

  return { ok: true, word: normaliseWord(word), verdict };
}
