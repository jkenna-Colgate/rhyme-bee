/**
 * What counts as a Submit, and how much of one the endpoint will read. The whole
 * of the decision with none of the transport, so the two things most worth
 * getting right about a route that **writes to `data/` and then rebuilds the
 * Rhyme Index** can be tested without standing a dev server up — the split
 * `editorTierRequest.ts` and `editorDemotionRequest.ts` both make, for the same
 * reason.
 *
 * A day *is* named here, unlike on the demotion route, and so — for a batch
 * raised from the Candidate Queue — is a Rhyme Key. They are the two ways one
 * add can name its target. The editor never types a key, so for their own batch
 * the date is how the endpoint finds one: it resolves it out of
 * `data/schedule.json` itself rather than taking a key from the browser, which
 * is what stops a screen that has drifted from the schedule aiming a night's
 * words at the wrong family. A Candidate is the case where nothing has to be
 * resolved, because the Candidate *is* a word aimed at a key — the one its
 * Appeal was recorded against — and most Candidates belong to no scheduled day
 * for a date to reach (#176, #178).
 *
 * The date's *spelling* is checked here and its *existence* is not, and the same
 * split holds for the key: whether the run covers a date, or a Puzzle is ever
 * dealt on a key, is a question about `data/schedule.json`, which this module
 * does not read. The endpoint asks it, because it is the module holding the
 * schedule.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isRhymeKeyShape } from "../src/declines.ts";
import { MAX_QUEUED_WORDS, type AddSubmitRequest } from "./src/editor/add.ts";

/** ISO `YYYY-MM-DD`, the spelling the schedule artifact uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Words are lower-case letters — `data/words.txt`'s own shape for all 370,105. */
const WORD = /^[a-z]+$/;

/**
 * How many bytes one word costs in this body, JSON quoting and comma included.
 *
 * Forty-five covers a 42-letter spelling; the longest word in `data/words.txt`
 * is 29 letters, so this is the generous end of a bound rather than a fit.
 */
const BYTES_PER_WORD = 45;

/**
 * Everything in the body that is not a word: the two field names, the date
 * (`"date":"2026-08-10",` is 20), the Rhyme Key (`"rhymeKey":"AH S T",` is 20,
 * and the longest key in the index is a handful of phonemes), the two brackets
 * and the two braces. Under seventy bytes in the worst case, rounded up.
 */
const ENVELOPE_BYTES = 128;

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * `2 × 45 × 50 + 128 = 4628`. The doubling is `appealed` and nothing else: a
 * batch every word of which was raised from the Candidate Queue names each of
 * them a **second** time in that list (#178), so the words cost twice what they
 * did before this slice. It is a bound on the worst case rather than a widening
 * of what the route accepts — `MAX_QUEUED_WORDS` is unchanged at 50, and a
 * 51-word batch is refused by the count regardless of how few bytes it came in.
 *
 * Its own constant rather than the demotion route's 512 on that module's
 * reasoning — tying two caps together would mean a change to either being
 * reasoned about as a change to both — and this body is a different shape from
 * every other route's: it is the one that carries a list.
 *
 * The byte cap is the cheap guard and not the real one. What actually bounds a
 * Submit is the word count, because a word no compound split reaches costs up to
 * a minute of agent time; see `MAX_QUEUED_WORDS`.
 */
export const MAX_ADD_BODY_BYTES = 2 * BYTES_PER_WORD * MAX_QUEUED_WORDS + ENVELOPE_BYTES;

/**
 * What a body turned out to be: the Submit it asks for, or the sentence saying
 * why it is not one.
 *
 * The accepted arm is `AddSubmitRequest` itself rather than a hand-written
 * `{ date, words }` beside it, so the shape this parser hands the endpoint is
 * checked against the one the browser builds instead of matching it by eye.
 */
export type AddWriteRequest = ({ ok: true } & AddSubmitRequest) | { ok: false; error: string };

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

  const { date, words, rhymeKey } = parsed as {
    date?: unknown;
    words?: unknown;
    rhymeKey?: unknown;
  };
  // The key first, because whether a date is required at all depends on it.
  let aimedAt: string | undefined;
  if (rhymeKey !== undefined) {
    if (typeof rhymeKey !== "string" || !isRhymeKeyShape(rhymeKey.trim())) {
      return {
        ok: false,
        error:
          `"${String(rhymeKey)}" is not a Rhyme Key. An add raised from a Candidate is aimed at ` +
          "the key the Appeal was recorded against.",
      };
    }
    aimedAt = rhymeKey.trim();
  }
  // A date is `null` only for a batch that names a key: there is then nothing to
  // resolve and no day on screen to re-read. Anything else with no usable date
  // is a Submit aimed at nothing.
  if (date !== null && (typeof date !== "string" || !ISO_DATE.test(date))) {
    return {
      ok: false,
      error: `"${String(date)}" is not a date. An add is aimed at a day, written YYYY-MM-DD.`,
    };
  }
  if (date === null && aimedAt === undefined) {
    return {
      ok: false,
      error:
        "An add names a day or a Rhyme Key to aim at, and this names neither. " +
        "A batch with no target has no family to be written against.",
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

  const { appealed, error } = appealedIn(parsed, normalised);
  if (error !== null) return { ok: false, error };

  // The key is omitted rather than carried as `undefined` when the batch names
  // none, so a body that named no target and a body that named a day are the
  // same value here as well as the same request.
  return {
    ok: true,
    date,
    words: normalised,
    appealed,
    ...(aimedAt === undefined ? {} : { rhymeKey: aimedAt }),
  };
}

/**
 * The subset of the batch a player asked for, out of a body that may not name
 * one at all.
 *
 * **Absent is `[]`, not an error.** A batch the editor typed themselves carries
 * no provenance, which is the ordinary case and the only one that existed before
 * #178; a body that omits the field is that batch, not a malformed request.
 *
 * A word named here that is not in the batch **is** refused, rather than
 * dropped. It can only be a caller that has lost track of its own queue, and the
 * quiet failure is the bad one: the word would simply not be written, and the
 * editor would find a reading in `data/supplement.dict` with no note on it and
 * no way to tell that the note was meant to be there. Duplicates are refused for
 * the reason the batch's own are — a list that says a thing twice is a list one
 * of whose entries is a mistake.
 *
 * Every word is normalised the way the batch's are, so the two lists are
 * compared in one spelling and `add` can match them by name.
 */
function appealedIn(
  parsed: unknown,
  words: readonly string[],
): { appealed: string[]; error: string | null } {
  const raw = (parsed as { appealed?: unknown }).appealed;
  if (raw === undefined) return { appealed: [], error: null };
  if (!Array.isArray(raw) || raw.some((word) => typeof word !== "string")) {
    return {
      appealed: [],
      error: "The Candidates in an add are named as a list of words, or not at all.",
    };
  }

  const appealed = (raw as string[]).map(normaliseWord);
  const stray = appealed.find((word) => !words.includes(word));
  if (stray !== undefined) {
    return {
      appealed: [],
      error: `"${stray}" is named as raised from a Candidate but is not in the batch.`,
    };
  }
  if (new Set(appealed).size !== appealed.length) {
    return { appealed: [], error: "That batch names the same Candidate twice." };
  }
  return { appealed, error: null };
}
