/**
 * What counts as an evidence lookup, and how much of one the endpoint will read.
 * The whole of the decision with none of the transport, so it can be tested
 * without standing a dev server up — the split `editorAddRequest.ts`,
 * `editorTierRequest.ts` and `editorDemotionRequest.ts` all make.
 *
 * They make it because they guard a route that **writes to `data/`** and this
 * route writes nothing at all, so the reason here is the narrower one: the parse
 * is where the request's two rules live — one Rhyme Key, and a ceiling on how
 * many words one lookup carries — and a rule that can only be exercised through
 * a socket is a rule nobody exercises.
 *
 * A Rhyme Key is named outright rather than resolved from a date, which is the
 * opposite of what `editorAddRequest.ts` does and is not an inconsistency. That
 * module re-resolves the date because an add **writes** a reading against
 * whatever key it is told, so a screen that had drifted from `data/schedule.json`
 * could put a night's words in the wrong family. Nothing is written here. The
 * key is only what the evidence is *held against*, it travels back on the reply
 * so the browser can check it is still the key on screen
 * (`web/src/editor/evidence.ts`), and a lookup aimed at a key no Puzzle is ever
 * dealt on is a fair question with a boring answer.
 *
 * The key's *shape* is checked here and its *existence* is not, for the reason
 * the date's is not: whether a Puzzle is ever dealt on a key is a question about
 * `data/schedule.json`, which this module does not read.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isRhymeKeyShape } from "../src/declines.ts";
import type { EvidenceRequest } from "./src/editor/evidence.ts";

/** Words are lower-case letters — `data/words.txt`'s own shape for all 370,105. */
const WORD = /^[a-z]+$/;

/**
 * How many words one lookup answers about.
 *
 * **Not the same kind of number as `MAX_QUEUED_WORDS`**, and the difference is
 * the whole reason it is three orders larger. A queued add costs up to a minute
 * of agent time per word it cannot compose, so fifty is already a long evening.
 * A lookup costs one parse of the pinned sources — which happens once per
 * request regardless — plus a map read and a compound split per word. Nothing
 * here waits on anything.
 *
 * So the ceiling is not sizing the work; it is refusing a body that could only
 * be a mistake. #186 asks for a paste of **any size** and means it: the editor
 * controls the volume by what they select, the join itself is uncapped, and the
 * measured `idiotic` day sent 241 words. Five thousand is far past any rhyme
 * list a third party publishes for one Rhyme Key, which is what makes it a
 * ceiling the feature never touches rather than a cap it fights.
 */
export const MAX_EVIDENCE_WORDS = 5000;

/**
 * How many bytes one word costs in this body, JSON quoting and comma included.
 * Forty-five covers a 42-letter spelling; the longest word in `data/words.txt`
 * is 29 letters. `editorAddRequest.ts`'s number, for the same list-of-words
 * shape.
 */
const BYTES_PER_WORD = 45;

/**
 * Everything in the body that is not a word: the two field names, the Rhyme Key
 * (`"rhymeKey":"AA T IH K",` is 24, and the longest key in the index is a
 * handful of phonemes), the brackets and the braces. Under seventy bytes,
 * rounded up.
 */
const ENVELOPE_BYTES = 128;

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * Its own constant rather than any other route's, on `web/editorTransport.ts`'s
 * argument: each route's ceiling is sized to what that route carries, and tying
 * two together would mean a change to either being reasoned about as a change to
 * both. This is by far the largest of them, and it is also the only one guarding
 * a route that writes nothing — the two facts are the same fact.
 */
export const MAX_EVIDENCE_BODY_BYTES = BYTES_PER_WORD * MAX_EVIDENCE_WORDS + ENVELOPE_BYTES;

export type EvidenceReadRequest =
  | ({ ok: true } & EvidenceRequest)
  | { ok: false; error: string };

/**
 * The lookup a request body asks for.
 *
 * **An empty list is allowed**, though the browser never sends one — the panel
 * has nothing to ask about when the day covers the whole paste, and does not
 * ask. It is allowed because refusing it would be this parser inventing a rule:
 * "what is true of these nought words" is a well-formed question with an empty
 * answer, and a 400 on it would be a refusal with nothing wrong behind it. The
 * parse guards the two things that *can* be wrong — the key's shape and the
 * words' — and stops there.
 *
 * Every word is normalised the way `gatherEvidence` normalises it on the way in,
 * so the facts come back about the word that was asked about rather than a
 * near-miss of it — and so the reply can be matched to the request by name.
 * Duplicates are refused rather than collapsed, for `editorAddRequest.ts`'s
 * reason: a reply shorter than the list it answers reads as words that were
 * lost. The browser cannot send one — the paste dedupes before it joins — so a
 * duplicate here is a caller that has lost track of its own list.
 */
export function evidenceReadRequest(body: string): EvidenceReadRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not an evidence lookup." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not an evidence lookup." };
  }

  const { rhymeKey, words } = parsed as { rhymeKey?: unknown; words?: unknown };
  if (typeof rhymeKey !== "string" || !isRhymeKeyShape(rhymeKey.trim())) {
    return {
      ok: false,
      error:
        `"${String(rhymeKey)}" is not a Rhyme Key. A lookup is held against one key — ` +
        "the day's — and never a set of them.",
    };
  }
  if (!Array.isArray(words) || words.some((word) => typeof word !== "string")) {
    return { ok: false, error: "A lookup names words. Expected a list of them." };
  }
  if (words.length > MAX_EVIDENCE_WORDS) {
    return {
      ok: false,
      error:
        `That is ${words.length} words, and one lookup answers about ${MAX_EVIDENCE_WORDS}. ` +
        "That is more than any rhyme list published for a single Rhyme Key, so it is worth checking what was pasted.",
    };
  }

  const normalised = (words as string[]).map(normaliseWord);
  const malformed = normalised.find((word) => !WORD.test(word));
  if (malformed !== undefined) {
    return {
      ok: false,
      error: `"${malformed}" is not a word. A lookup names words, in letters.`,
    };
  }
  if (new Set(normalised).size !== normalised.length) {
    return { ok: false, error: "That lookup names the same word twice." };
  }

  return { ok: true, rhymeKey: rhymeKey.trim(), words: normalised };
}
