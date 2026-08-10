/**
 * The built Rhyme Index, loaded once and shared by every dev-only editor
 * endpoint that needs it.
 *
 * It is one module rather than a `let` in each plugin because the artifact is
 * fifteen megabytes: two plugins each keeping their own copy would hold thirty,
 * for one repository's one index. Loaded on first use and not when a plugin is
 * constructed — `npm run dev` starts whether or not an index has been built,
 * which is the call `vite.config.ts` already makes for the player's shell, and
 * the editor's screen says what is missing rather than the dev server refusing
 * to start.
 *
 * It parses the artifact itself instead of calling `loadRhymeIndex`, for one
 * reason: `loadRhymeIndex` returns the index and discards the config beside it,
 * and the Tier picker needs the **Answer/Bonus threshold that index was built
 * with** to re-tier a word in the browser. Reading it any other way would mean
 * parsing fifteen megabytes twice, or restating the build's own
 * `KNOWNNESS_THRESHOLD` here and hoping the two agree.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { indexArtifactPath } from "../scripts/indexArtifact.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Built {
  index: RhymeIndex;
  knownnessThreshold: number;
}

let built: Built | undefined;

function load(): Built {
  const path = indexArtifactPath(resolve(repoRoot, "dist-data"));
  const artifact = JSON.parse(readFileSync(path, "utf8")) as SerialisedIndex;
  return { index: deserialise(artifact), knownnessThreshold: artifact.config.knownnessThreshold };
}

/** The built index. 510 ms to read, and a session of the pass asks for many days. */
export function builtIndex(): RhymeIndex {
  built ??= load();
  return built.index;
}

/**
 * The Answer/Bonus line the built index carries — the artifact's own, not the
 * environment's. What the picker simulates is a change to *the index on screen*,
 * so the threshold it re-tiers against has to be the one that produced the day
 * being looked at.
 */
export function builtKnownnessThreshold(): number {
  built ??= load();
  return built.knownnessThreshold;
}

/**
 * Drop the loaded copy, so the next caller reads the artifact off disk again.
 *
 * This exists for exactly one caller — `rebuildIndex` (`web/indexRebuild.ts`),
 * which is what Submit runs — and it is the difference between that feature
 * working and appearing to. The cache above is a `let` in a module the dev
 * server keeps for its whole lifetime, so a rebuild that left it standing would
 * hand the re-read the *superseded* index: every figure on the day would come
 * from the artifact as it was before the adds, look entirely plausible, and be
 * wrong. Worse, the artifact is content-addressed (`scripts/indexArtifact.ts`),
 * so the file the stale copy was parsed from has usually been swept off disk by
 * the rebuild that replaced it — the screen would be reporting an index that no
 * longer exists.
 *
 * Forgetting rather than eagerly reloading: the fifteen megabytes cost half a
 * second to parse and the next request pays it, which is the request that
 * actually needs the index. A reload here would pay it inside the rebuild, on
 * behalf of a caller that may be about to jump to another day anyway.
 */
export function forgetBuiltIndex(): void {
  built = undefined;
}
