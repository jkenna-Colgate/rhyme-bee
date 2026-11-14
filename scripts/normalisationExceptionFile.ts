/**
 * The write to `data/normalisation-exceptions.txt` (#323): one line appended
 * for a Normalisation Exception the Batch's ruling list makes. The format is
 * `src/normalisationExceptions.ts`'s; this file only touches the path.
 *
 * Append and never rewrite, for `web/demotionFile.ts`'s reason: the file is
 * committed and hand-edited, with comments a rewrite from parsed lines would
 * drop. Taking an exception back is a hand edit, so nothing here removes one.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { serialiseNormalisationException, type NormalisationException } from "../src/normalisationExceptions.ts";

/**
 * Append one exception. A file whose last line has no newline gets one first,
 * in the same write, so the new line is not swallowed into a hand-written
 * comment or fused onto the line before it.
 */
export function appendNormalisationException(path: string, exception: NormalisationException): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(path, prefix + serialiseNormalisationException(exception));
}
