/**
 * The Declines file's IO: reading `data/declines.txt` and **appending one ruling
 * to it**. `src/declines.ts` owns the format and stays pure — the pair, the
 * lookup, the serialise, the parse — and this is the one module that puts that
 * format on a disk.
 *
 * It sits beside `web/demotionFile.ts` and `web/tierOverrideFile.ts`, and is
 * deliberately not in `src/`, for the reason those two give: nothing the engine
 * builds ever opens this file — nothing the engine builds *reads* it at all, in
 * fact, because a Decline changes no verdict — and its only reader and only
 * writer are the Editor's Pass, which is a browser tool (ADR-0016) served by
 * dev-only Vite plugins.
 *
 * ## The append is repaired, never trusted
 *
 * `serialiseDecline` returns a newline-**terminated** line, which makes an
 * append correct only if what is already on disk also ends in a newline. If it
 * does not, the two rulings fuse into one line — `docked AA K T lbs AH B AH L`
 * — and the fusion is *silent*: `parseDeclines` reads that as one ruling for
 * `docked` on the key `AA K T LBS AH B AH L`, which nothing will ever ask about.
 * Two rulings go in and neither comes back.
 *
 * That is the same hazard `demotionFile.ts` repairs and the opposite failure
 * mode. There, a fused line throws and takes the whole index build with it,
 * which is loud; here nothing throws, nothing is logged, and the editor simply
 * finds the Candidates they ruled on still sitting on the queue next week. The
 * file is hand-editable committed data — reversing a Decline is deleting its
 * line — so it is designed to be opened in an editor between two machine
 * appends, and an editor that trims the trailing newline is the whole of it.
 *
 * Loosening the parser to split a fused line was rejected here for the reason it
 * was rejected there: a parser that tolerates a fused line cannot tell
 * corruption from data. Repairing on write keeps the format one line per ruling
 * and costs one read of a file of a few hundred bytes.
 *
 * There is no header to write. The format is two fields of plain text and the
 * file carries a hand-written comment block instead; a comment is not something
 * a machine should author, so an absent file simply gets its first ruling.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serialiseDecline, type Decline } from "../src/declines.ts";
import { readOptional } from "./readOptional.ts";
import { repoRoot } from "./repoRoot.ts";

/**
 * Where the standing rulings live.
 *
 * Declared here rather than at each plugin — the shape `editorDemotionPlugin.ts`
 * uses for the demotion list — because this file has *two* readers:
 * `web/editorCandidatesPlugin.ts`, which reads the standing rulings into the
 * queue readout, and `web/editorDeclinePlugin.ts`, which reads and appends. Two
 * plugins each resolving their own path is two spellings of one location, and
 * the failure when they drift is a ruling written to a file nobody reads.
 */
export const DECLINES_PATH = resolve(repoRoot, "data/declines.txt");

/**
 * The file's text, or `""` when there is no file — this module's name for
 * `readOptional`, which is the index build's own rule and is shared rather than
 * copied (`web/readOptional.ts`).
 *
 * Named here because a caller of this module is reading *rulings*, and because
 * the append below is written against the string this returns: the two are one
 * format's IO and the read is half of it. A missing file is "no rulings", not an
 * error, and it is the live state of this file for as long as nobody has
 * declined anything.
 */
export function readDeclineText(path: string): string {
  return readOptional(path);
}

/**
 * What has to be written *before* a ruling, given whatever is already on disk.
 *
 * Two cases, and they are the two ways an append can go wrong:
 *
 * - **A file that does not end in a newline** — a newline goes first. This is
 *   the repair, and it is the whole reason this function exists. It covers the
 *   quiet form as well: a last line ending in a hand-written `#` gloss would
 *   otherwise swallow the appended ruling into its comment, recording nothing
 *   and saying nothing.
 * - **Anything else, including no file at all** — nothing goes first.
 *
 * A file holding only whitespace counts as empty, matching `demotionFile.ts`'s
 * own `appendPrefix`: `parseDeclines` skips blank lines, so a whitespace-only
 * file is "no rulings" and a ruling appended after them should not become a
 * stray blank first line the maintainer's diff has to explain.
 */
function appendPrefix(existing: string): string {
  if (existing.trim() === "") return "";
  return existing.endsWith("\n") ? "" : "\n";
}

/**
 * Append one ruling, repairing the file's ending first if it needs it.
 *
 * Append rather than rewrite: `data/declines.txt` is committed data with a
 * hand-written comment block in it, and rewriting it from parsed rulings would
 * drop every gloss the editor wrote — which on this file is most of its value,
 * since the ruling itself records only *that* a Candidate was declined and the
 * gloss is where *why* lives. The prefix is written in the **same**
 * `appendFileSync` call as the ruling, so there is no window in which the file
 * has gained a bare newline and not the ruling it was repaired for.
 *
 * A file that is empty, absent, or holds only whitespace is written rather than
 * appended to, so neither an empty string nor stray whitespace survives at the
 * top of a file the maintainer reads in a diff.
 */
export function appendDecline(path: string, decline: Decline): void {
  const existing = readDeclineText(path);
  const line = appendPrefix(existing) + serialiseDecline(decline);
  if (existing.trim() === "") writeFileSync(path, line);
  else appendFileSync(path, line);
}
