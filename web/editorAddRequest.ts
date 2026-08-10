/**
 * What counts as a Submit, and how much of one the endpoint will read. The whole
 * of the decision with none of the transport, so the two things most worth
 * getting right about a route that **writes to `data/` and then rebuilds the
 * Rhyme Index** can be tested without standing a dev server up — the split
 * `editorTierRequest.ts` and `editorDemotionRequest.ts` both make, for the same
 * reason.
 *
 * A day *is* named here, unlike on the demotion route. An add is aimed at one
 * Rhyme Key and the editor never types one, so the date is how the endpoint
 * finds the key: it resolves it out of `data/schedule.json` itself rather than
 * taking a key from the browser, which is what stops a screen that has drifted
 * from the schedule aiming a night's words at the wrong family.
 *
 * The date's *spelling* is checked here and its *existence* is not. Whether the
 * run covers a date is a question about `data/schedule.json`, which this module
 * does not read; the endpoint asks it, because it is the module holding the
 * schedule.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { MAX_QUEUED_WORDS } from "./src/editor/add.ts";

/** ISO `YYYY-MM-DD`, the spelling the schedule artifact uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Words are lower-case letters — `data/words.txt`'s own shape for all 370,105. */
const WORD = /^[a-z]+$/;

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * Sized to `MAX_QUEUED_WORDS` words: forty-five bytes each covers the longest
 * spelling anyone will type with room to spare, plus the date and JSON's own
 * punctuation. Its own constant rather than the demotion route's 512 on that
 * module's reasoning — tying two caps together would mean a change to either
 * being reasoned about as a change to both — and this body is a different shape
 * from every other route's: it is the one that carries a list.
 *
 * The byte cap is the cheap guard and not the real one. What actually bounds a
 * Submit is the word count, because a word no compound split reaches costs up to
 * a minute of agent time; see `MAX_QUEUED_WORDS`.
 */
export const MAX_ADD_BODY_BYTES = 45 * MAX_QUEUED_WORDS + 128;

export type AddWriteRequest =
  | { ok: true; date: string; words: string[] }
  | { ok: false; error: string };

/**
 * The batch a request body carries.
 *
 * An empty list is **allowed here and decided elsewhere**, which is a reversal
 * of #161's rule and is #162's central widening. #161 refused it outright: a
 * Submit with no words costs a full rebuild, and a rebuild for nothing is the
 * cost a night of Tier judgements alone must never pay. What that missed is
 * that a night of Tier judgements alone is not nothing — the verdicts are on
 * disk, the artifact predates them, and the empty Submit is the *only* way to
 * fold them in from the browser. So an empty batch is now refused exactly when
 * the index is current and accepted when it is stale.
 *
 * That decision cannot be made in this module, and deliberately is not faked
 * here. Staleness is a fact about `dist-data/` and `data/` on disk; this module
 * reads no files, which is the whole reason it can be tested without a
 * repository around it. The endpoint holds the rule, because the endpoint is
 * what can ask. Taking the browser's word for it was rejected for the reason
 * the date is re-resolved server-side: a client's copy of a fact about the
 * maintainer's disk is a guess, and the guess that is wrong here rebuilds for
 * nothing or refuses work that is genuinely waiting.
 *
 * Every word is normalised the way `gatherEvidence` normalises it on the way in,
 * so a word queued with a stray capital is the word that gets judged. Duplicates
 * are refused rather than collapsed: silently dropping one would answer with a
 * readout shorter than the batch the editor submitted, and a row missing from a
 * readout reads as a word that was lost.
 */
export function addWriteRequest(body: string): AddWriteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not a batch of adds." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not a batch of adds." };
  }

  const { date, words } = parsed as { date?: unknown; words?: unknown };
  if (typeof date !== "string" || !ISO_DATE.test(date)) {
    return {
      ok: false,
      error: `"${String(date)}" is not a date. An add is aimed at a day, written YYYY-MM-DD.`,
    };
  }
  if (!Array.isArray(words) || words.some((word) => typeof word !== "string")) {
    return { ok: false, error: "An add names words. Expected a list of them." };
  }
  if (words.length > MAX_QUEUED_WORDS) {
    return {
      ok: false,
      error:
        `That is ${words.length} words, and one Submit carries ${MAX_QUEUED_WORDS}. ` +
        "A word the composition cannot reach waits on an agent for up to a minute, so a longer batch is a longer evening than it looks.",
    };
  }

  const normalised = (words as string[]).map(normaliseWord);
  const malformed = normalised.find((word) => !WORD.test(word));
  if (malformed !== undefined) {
    return {
      ok: false,
      error: `"${malformed}" is not a word. An add names words, in letters.`,
    };
  }
  if (new Set(normalised).size !== normalised.length) {
    return { ok: false, error: "That batch names the same word twice." };
  }

  return { ok: true, date, words: normalised };
}
