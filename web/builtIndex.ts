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
 *
 * ## Why a factory, when the dev server only ever wants the one
 *
 * `makeIndexCache` takes the artifact directory, and the module-level
 * `builtIndex` / `builtKnownnessThreshold` / `forgetBuiltIndex` below are one
 * instance of it bound to `repoRoot/dist-data`. The dev server has exactly one
 * index and wants exactly that instance; the parameter exists because the
 * alternative — a `repoRoot` computed from `import.meta.url`, with no way in —
 * put the whole cache, and with it the invalidation `rebuildIndex` depends on,
 * out of reach of any test that is not willing to rebuild the real artifact.
 * A test now writes a small artifact into a temp directory and points a cache
 * at it, and the live path is the same construction with a different argument
 * rather than a code path the test never takes.
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

/** One artifact directory's parsed index, held until something forgets it. */
export interface IndexCache {
  /** The built index. 510 ms to read, and a session of the pass asks for many days. */
  index(): RhymeIndex;

  /**
   * The Answer/Bonus line the built index carries — the artifact's own, not the
   * environment's. What the picker simulates is a change to *the index on
   * screen*, so the threshold it re-tiers against has to be the one that
   * produced the day being looked at.
   */
  knownnessThreshold(): number;

  /**
   * Drop the loaded copy, so the next caller reads the artifact off disk again.
   *
   * This exists for exactly one caller of the dev server's own cache —
   * `rebuildIndex` (`web/indexRebuild.ts`), which is what Submit runs — and it
   * is the difference between that feature working and appearing to. That cache
   * is held for the server's whole lifetime, so a rebuild that left it standing
   * would hand the re-read the
   * *superseded* index: every figure on the day would come from the artifact as
   * it was before the adds, look entirely plausible, and be wrong. Worse, the
   * artifact is content-addressed (`scripts/indexArtifact.ts`), so the file the
   * stale copy was parsed from has usually been swept off disk by the rebuild
   * that replaced it — the screen would be reporting an index that no longer
   * exists.
   *
   * Forgetting rather than eagerly reloading: the fifteen megabytes cost half a
   * second to parse and the next request pays it, which is the request that
   * actually needs the index. A reload here would pay it inside the rebuild, on
   * behalf of a caller that may be about to jump to another day anyway.
   */
  forget(): void;
}

/** A cache over the current artifact in `distDataDir`, loaded on first ask. */
export function makeIndexCache(distDataDir: string): IndexCache {
  let built: Built | undefined;

  // Resolved on every load rather than once: the artifact is content-addressed,
  // so a rebuild changes the filename, and a path captured at construction
  // would send the re-read this cache exists to allow at a file the sweep has
  // already deleted.
  const load = (): Built => {
    const path = indexArtifactPath(distDataDir);
    const artifact = JSON.parse(readFileSync(path, "utf8")) as SerialisedIndex;
    return { index: deserialise(artifact), knownnessThreshold: artifact.config.knownnessThreshold };
  };

  return {
    index: () => (built ??= load()).index,
    knownnessThreshold: () => (built ??= load()).knownnessThreshold,
    forget: () => {
      built = undefined;
    },
  };
}

/**
 * The dev server's one cache, over the one artifact this repository builds.
 * The three functions below are its members under the names their call sites
 * already use.
 */
const defaultCache = makeIndexCache(resolve(repoRoot, "dist-data"));

/** {@link IndexCache.index} on the repository's own `dist-data`. */
export function builtIndex(): RhymeIndex {
  return defaultCache.index();
}

/** {@link IndexCache.knownnessThreshold} on the repository's own `dist-data`. */
export function builtKnownnessThreshold(): number {
  return defaultCache.knownnessThreshold();
}

/** {@link IndexCache.forget} on the repository's own `dist-data`. */
export function forgetBuiltIndex(): void {
  defaultCache.forget();
}
