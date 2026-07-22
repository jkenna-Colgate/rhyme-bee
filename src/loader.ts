/**
 * Load a built Rhyme Index from a local JSON artifact. Synchronous file read,
 * no network dependency (story 42) — adjudication is a pure function over what
 * this returns.
 */

import { readFileSync } from "node:fs";
import { deserialise, type SerialisedIndex } from "./serialise.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";

export function loadRhymeIndex(artifactPath: string): RhymeIndex {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as SerialisedIndex;
  return deserialise(artifact);
}
