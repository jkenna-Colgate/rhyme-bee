/**
 * Browser-side index loader: the shell's replacement for the Node `loader.ts`,
 * which reads the file with `readFileSync` and cannot run in a browser. A thin
 * adapter of `fetch(url) → JSON.parse → deserialise(...)` yielding a `RhymeIndex`
 * from the already-tested `deserialise`.
 *
 * Left untested by the same principle that leaves the Node `loader.ts` untested:
 * it is thin I/O over `deserialise`, which the engine suite already covers.
 */

import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";

export async function loadRhymeIndex(url: string): Promise<RhymeIndex> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch the index (${response.status} ${response.statusText}).`);
  }
  const artifact = JSON.parse(await response.text()) as SerialisedIndex;
  return deserialise(artifact);
}
