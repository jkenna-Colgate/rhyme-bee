/**
 * The Retrieval override layer's file IO: reading `data/tier-overrides.csv` and
 * **appending one judgement to it**. `src/tierOverride.ts` owns the format and
 * stays pure — the verdicts, the serialise, the parse, the last-wins resolution
 * — and this is the one module that puts that format on a disk.
 *
 * It is deliberately not in `src/`. The engine reads the layer at build time
 * through text handed to `manufactureIndexData`, and never touches a path; the
 * only writer is the Editor's Pass, which is a browser tool (ADR-0016) served by
 * a dev-only Vite plugin. Putting the writer beside that plugin keeps `src/`
 * free of a file path it has no use for, and keeps the whole of "how a judgement
 * reaches the disk" in one small module that can be driven over a temp
 * directory.
 *
 * ## The append is repaired, never trusted
 *
 * `serialiseTierOverride` returns a newline-**terminated** line, which makes an
 * append correct only if what is already on disk also ends in a newline. If it
 * does not, the two lines fuse into one row of ten columns, `parseTierOverrides`
 * throws over it — correctly, since a machine-written file that will not parse
 * means something upstream is wrong — and **every judgement in the file becomes
 * unreadable**. ADR-0015 makes that unrecoverable: the file is append-only
 * precisely because it can never be regenerated, so a corrupting write destroys
 * work that has no other copy.
 *
 * So the last byte is checked before every append, and a missing newline is
 * repaired by writing one first. The alternative — teaching the parser to split
 * a fused row — was rejected: a parser that tolerates a fused row cannot tell
 * corruption from data, and would let the file rot quietly in exactly the
 * circumstances where loudness is the only remedy left. Repairing on write keeps
 * the parser strict and the file readable, and costs one read of a file that is
 * a few KB.
 *
 * Reading the whole file to decide is not an optimisation target. It is a few
 * hundred rows at the outside, it happens once per click on a localhost dev
 * server, and reading it is what tells us whether the header has been written at
 * all.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  TIER_OVERRIDE_HEADER,
  serialiseTierOverride,
  type TierOverrideRow,
} from "../src/tierOverride.ts";

/**
 * The file's text, or `""` when no Editor's Pass has ever written it.
 *
 * A missing file is "no overrides", not an error — the same call
 * `scripts/build-index.ts` makes with `readOptional`, and for the same reason:
 * the layer may legitimately never have been written.
 */
export function readTierOverrideText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * What has to be written *before* a row, given whatever is already on disk.
 *
 * Three cases, and they are the three ways an append can go wrong:
 *
 * - **No file, or an empty one** — the header goes first, or the file's first
 *   row is a row the next reader has to guess the columns of.
 * - **A file that does not end in a newline** — a newline goes first. This is
 *   the repair, and it is the whole reason this function exists.
 * - **Anything else** — nothing goes first.
 *
 * A file holding only whitespace counts as empty: `parseTierOverrides` skips
 * blank lines, so a header written after them is still the file's first row, and
 * treating it as non-empty would produce a headerless file.
 *
 * Separated from the write so the decision can be read on its own; the write
 * below is then two lines with nothing to reason about.
 */
function appendPrefix(existing: string): string {
  if (existing.trim() === "") return `${TIER_OVERRIDE_HEADER}\n`;
  return existing.endsWith("\n") ? "" : "\n";
}

/**
 * Append one judgement, repairing the file's ending first if it needs it.
 *
 * Append rather than rewrite, as ADR-0015 requires: appending cannot corrupt
 * what is already written, whereas rewriting a row opens a crash window over a
 * file with no other copy. The prefix is written in the *same* `appendFileSync`
 * call as the row, so there is no window in which the file has gained a bare
 * newline and not the row it was repaired for.
 *
 * A file whose whitespace-only content is replaced wholesale is the one case
 * that does not append: an empty file has nothing to preserve, and
 * `writeFileSync` there keeps a stray blank line out of the top of a file the
 * maintainer reads in a diff.
 */
export function appendTierOverride(path: string, row: TierOverrideRow): void {
  const existing = readTierOverrideText(path);
  const line = appendPrefix(existing) + serialiseTierOverride(row);
  if (existing.trim() === "") writeFileSync(path, line);
  else appendFileSync(path, line);
}
