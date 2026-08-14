/**
 * The deferred readings file's IO: where `data/deferred-readings.jsonl` is, and
 * reading it back (#181). `scripts/editorDeferred.ts` owns the format and stays
 * pure — the parse, the state union, the section — and this is the one module
 * that puts a disk behind it.
 *
 * It sits beside `web/declinesFile.ts` and for its reason: the format module has
 * to be readable by the browser, which imports `isDeferralOutstanding` and the
 * union's types, and a module that reaches for `node:fs` cannot be. Splitting
 * the read out is what keeps the derivation callable over a fixture and the
 * front end free of `node:` imports.
 *
 * **There is no append here.** The one writer is the add path
 * (`appendToDeferredQueue` in `scripts/editorAdd.ts`), which has written this
 * file since ADR-0014 and goes on owning the write; this slice is the read back.
 * A second appender would be a second opinion about a file whose whole value is
 * that it is a complete record of what the pass could not resolve.
 */

import { resolve } from "node:path";
import { parseDeferredReadings, type DeferredRecord } from "../scripts/editorDeferred.ts";
import { readOptional } from "./readOptional.ts";
import { repoRoot } from "./repoRoot.ts";

/**
 * Where the deferred readings live.
 *
 * Declared here rather than at each caller, for `DECLINES_PATH`'s reason: the
 * file has a reader and a writer in different directories — the queue route
 * below and `add` in `scripts/editorAdd.ts` — and two spellings of one location
 * is a miss recorded where nobody reads it.
 */
export const DEFERRED_READINGS_PATH = resolve(repoRoot, "data/deferred-readings.jsonl");

/**
 * The records on file, or none at all.
 *
 * **A missing file is no deferrals and an empty one is no deferrals**, neither
 * of them an error: the file is zero bytes in the repository today, which is the
 * live case and the good one — it means every add the pass has asked for got a
 * reading. `readOptional` is the index build's own rule for a hand-written input
 * and is shared rather than copied.
 *
 * The path is an argument with the real file as its default, which is
 * `AddDeps.deferredPath`'s shape exactly: the two live surfaces pass nothing and
 * read `data/`, and a test hands it a temp file. A path rather than an injected
 * reader, so what is stood in for is *the file* and not the act of reading one.
 */
export function readDeferredReadings(path: string = DEFERRED_READINGS_PATH): DeferredRecord[] {
  return parseDeferredReadings(readOptional(path));
}
