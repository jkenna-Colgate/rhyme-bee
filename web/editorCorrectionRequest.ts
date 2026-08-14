/**
 * What counts as a correction request, and how much of one the endpoint will
 * read. The whole of the decision with none of the transport — the split
 * `editorAddRequest.ts`, `editorDeclineRequest.ts` and `editorTierRequest.ts`
 * all make, and worth making twice over on a route whose second act **writes to
 * `data/` and then rebuilds the Rhyme Index**.
 *
 * ## Two asks on one route
 *
 * The route answers both halves of one judgement, and the body says which:
 *
 * - a **word and a Rhyme Key** asks an agent to propose a correction, and writes
 *   nothing;
 * - the same, plus a **reading and a mode**, approves that proposal and writes.
 *
 * One path rather than two because the second is meaningless without the first
 * and they are one act to the editor, and because splitting them would put the
 * "nothing is written until you approve" guarantee in the *routing* rather than
 * in the request: here it is a fact about a body with no `phonemes` on it, which
 * is a thing this module can be asked about.
 *
 * The reading is echoed back by the caller rather than remembered on the server
 * for the same reason the add route re-resolves a date: a server holding "the
 * proposal for `tear`" between two requests is a second copy of a fact, and the
 * copy that is wrong is the one that writes an approval the editor never saw.
 * So an approval names exactly the phonemes it approves, and they are validated
 * here as though nothing had ever proposed them.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { isRhymeKeyShape } from "../src/declines.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import { CORRECTION_MODES, type CorrectionMode } from "./src/editor/correction.ts";

/**
 * Words are lower-case letters — `data/words.txt`'s own shape for all 370,105,
 * and the shape `editorDeclineRequest.ts` and `editorAddRequest.ts` each declare
 * for themselves. Declared a third time rather than shared, on those modules'
 * reasoning: a change to what one route accepts is not a change to the others.
 */
const WORD = /^[a-z]+$/;

/**
 * ARPAbet phoneme, with an optional stress digit — the shape
 * `scripts/editorReading.ts` accepts off an agent's stdout.
 *
 * Checked again here, even though the reading on an approval came from a
 * proposal this same route served, because the next thing that happens to it is
 * a line appended to committed data: `parseCmudict` reads whatever follows the
 * head word as phonemes, so a token that is not one becomes part of a
 * pronunciation the whole game then adjudicates against.
 */
const PHONEME = /^[A-Z]{1,3}[012]?$/;

/**
 * How many phonemes one reading may hold.
 *
 * The longest word in `data/words.txt` is 29 letters, and no English word takes
 * more phonemes than letters by much; 64 is the generous end of a bound rather
 * than a fit. It exists because the reading is unbounded input on a route that
 * writes committed data, not because any real reading is near it.
 */
const MAX_PHONEMES = 64;

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A word, a Rhyme Key, a mode and a reading: `64 × 5` bytes of phonemes and
 * their quoting, plus a hundred or so of envelope. 1024 is that rounded up.
 *
 * Its own constant rather than the decline route's 512, on that module's
 * reasoning — tying two caps together would mean a change to either being
 * reasoned about as a change to both — and this body is the larger of the two
 * because it is the one that carries a pronunciation.
 */
export const MAX_CORRECTION_BODY_BYTES = 1024;

/** What a body turned out to be: one of the two asks, or why it is neither. */
export type CorrectionRequest =
  | { ok: true; ask: "propose"; word: string; rhymeKey: RhymeKey }
  | {
      ok: true;
      ask: "approve";
      word: string;
      rhymeKey: RhymeKey;
      phonemes: Pronunciation;
      mode: CorrectionMode;
    }
  | { ok: false; error: string };

/**
 * The ask a request body carries.
 *
 * The word and the key are required on both, and neither has a default. A
 * correction is aimed at the Rhyme Key the Candidate was recorded against —
 * that is what the proposal is measured against and what the readout names — and
 * most Candidates belong to no scheduled day for a date to have reached.
 *
 * `phonemes` is what makes it an approval, and `mode` is then required rather
 * than defaulted. A default would be the tool choosing between replacing a
 * reading and joining it, which is the one choice ADR-0017 puts in the editor's
 * hands because only they know which situation they are in.
 */
export function correctionRequest(body: string): CorrectionRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "That request body is not a correction." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "That request body is not a correction." };
  }

  const { word, rhymeKey, phonemes, mode } = parsed as {
    word?: unknown;
    rhymeKey?: unknown;
    phonemes?: unknown;
    mode?: unknown;
  };

  if (typeof word !== "string" || !WORD.test(normaliseWord(word))) {
    return {
      ok: false,
      error: `"${String(word)}" is not a word. A correction names one word, in letters.`,
    };
  }
  if (typeof rhymeKey !== "string" || !isRhymeKeyShape(rhymeKey.trim())) {
    return {
      ok: false,
      error:
        `"${String(rhymeKey)}" is not a Rhyme Key. A correction is judged against the key the ` +
        "Candidate was recorded against, which is what the proposal has to reach.",
    };
  }

  const named = normaliseWord(word);
  const target = rhymeKey.trim();

  // No reading is the *proposal* ask, and the whole of what makes it one: a body
  // with nothing to write cannot be an approval however it is read.
  if (phonemes === undefined) {
    if (mode !== undefined) {
      return {
        ok: false,
        error:
          "That names replace or join but no reading to write. Ask for a proposal first — " +
          "nothing is written until a reading is approved.",
      };
    }
    return { ok: true, ask: "propose", word: named, rhymeKey: target };
  }

  if (
    !Array.isArray(phonemes) ||
    phonemes.length === 0 ||
    phonemes.length > MAX_PHONEMES ||
    phonemes.some((p) => typeof p !== "string" || !PHONEME.test(p))
  ) {
    return {
      ok: false,
      error:
        "That is not a reading. An approved correction names the phonemes as a list of ARPAbet " +
        "symbols, with stress digits on the vowels.",
    };
  }
  // The two the card offers, imported rather than re-listed: a third mode would
  // otherwise be a mode the browser can send and this route silently refuses.
  if (typeof mode !== "string" || !CORRECTION_MODES.some((m) => m === mode)) {
    return {
      ok: false,
      error:
        `"${String(mode)}" is not a choice. A correction either replaces the engine's reading ` +
        "or joins it as an alternate, and only the editor knows which.",
    };
  }

  return {
    ok: true,
    ask: "approve",
    word: named,
    rhymeKey: target,
    phonemes: phonemes as Pronunciation,
    mode: mode as CorrectionMode,
  };
}
