/**
 * A file's text, or `""` when there is none.
 *
 * The rule `scripts/build-index.ts` applies to every one of its hand-curated
 * inputs, under the same name: a missing hand-written file is *no entries*, not
 * an error. `data/declines.txt` before anybody has declined anything and
 * `data/supplement-candidates.jsonl` before the first pull from R2 are both that
 * state, and both are the ordinary case on a fresh clone rather than a fault.
 *
 * Its own module because two of the editor's dev-only plugins want it —
 * `web/editorCandidatesPlugin.ts` for the capture queue and `web/declinesFile.ts`
 * for the rulings over it — and a two-line function copied into each is a
 * two-line function that can be repaired in one of them. `web/demotionFile.ts`
 * and `web/tierOverrideFile.ts` still hold their own; folding those in is a
 * separate change with a wider blast radius, and their duplication is accepted
 * for now rather than overlooked.
 */

import { existsSync, readFileSync } from "node:fs";

export function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
