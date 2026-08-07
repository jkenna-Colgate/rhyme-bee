/**
 * The built index is an **immutable, content-addressed artifact** (#117).
 *
 * `build-index` writes it as `index-<hash>.json`, where the hash is taken over
 * the serialised bytes, so a rebuilt judge is a different filename rather than
 * the same filename with different contents. That is what lets the deploy serve
 * it with a long-lived immutable cache directive and still reach every browser
 * on the next deploy, and what lets the maintainer say exactly which judge a
 * given player saw. See ADR-0013.
 *
 * Beside it goes `index.manifest.json`, naming the current artifact. **The
 * manifest is generated and intentionally unused at runtime.** The web build
 * reads it here, on the maintainer's machine, and bakes the filename into the
 * bundle; the client never fetches it. It is kept because it is the documented
 * upgrade path to a split deploy, where the index and the bundle ship
 * separately — at which point adopting it is turning one constant into a
 * `fetch`. It is not dead code; do not delete it, and do not wire a runtime
 * fetch to it.
 *
 * This module is the one place that knows the naming shape. The offline scripts
 * that read the index (`play`, `histogram`, `build-schedule`) and the web build
 * config all resolve it through here, so none of them can disagree about which
 * artifact is current.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Names the current artifact. Written by the build, read only at build time. */
export const MANIFEST_FILENAME = "index.manifest.json";

/**
 * Deliberately not `index-manifest.json`: the deploy's cache rule for hashed
 * artifacts is the glob `/index-*.json`, and the manifest is the one mutable
 * file of the set. Keeping it off that glob keeps it off the immutable cache.
 */
const ARTIFACT_PATTERN = /^index-[0-9a-f]+\.json$/;

/**
 * What the index was called before it was content-addressed. Builds from before
 * #117 left one behind, and it survived the sweep below because it does not
 * match the pattern — a stale copy of the whole index, inert but indistinguish-
 * able at a glance from the real one. A second, different judge lying beside the
 * current one is the kind of thing that later gets found and believed, so the
 * build clears it rather than leaving it to be recognised.
 */
const LEGACY_ARTIFACT_FILENAME = "index.json";

/** 64 bits of SHA-256. Collisions are not the threat model; typos are. */
const HASH_LENGTH = 16;

/**
 * Asked for when no index has been built yet. Nothing serves it, which is the
 * point: the shell's existing error state is a better answer in development
 * than a dev server that refuses to start. A production build refuses instead.
 */
export const UNBUILT_ARTIFACT_FILENAME = "index-not-built.json";

export interface IndexManifest {
  /** Filename of the current artifact, relative to the artifact directory. */
  index: string;
  /** The content hash the filename carries, on its own, for reporting. */
  hash: string;
}

/** The content-addressed name the given serialised index would be written as. */
export function artifactName(contents: string): IndexManifest {
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, HASH_LENGTH);
  return { index: `index-${hash}.json`, hash };
}

/**
 * Write the artifact under its content-addressed name and the manifest beside
 * it, then drop indexes from earlier builds — both the content-addressed ones
 * and the pre-#117 `index.json`. The sweep is not tidiness: this directory is
 * where the offline scripts and the dev server look for *the* index, and a stale
 * 15 MB copy of a judge nobody is running is a thing to be believed by mistake.
 */
export function writeIndexArtifact(outDir: string, contents: string): IndexManifest {
  const manifest = artifactName(contents);
  writeFileSync(resolve(outDir, manifest.index), contents);

  for (const name of readdirSync(outDir)) {
    const superseded = ARTIFACT_PATTERN.test(name) && name !== manifest.index;
    if (superseded || name === LEGACY_ARTIFACT_FILENAME) rmSync(resolve(outDir, name));
  }

  writeFileSync(resolve(outDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** The current manifest, or `null` if no index has been built into `outDir`. */
export function readIndexManifest(outDir: string): IndexManifest | null {
  const manifestPath = resolve(outDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as IndexManifest;
  return existsSync(resolve(outDir, manifest.index)) ? manifest : null;
}

/**
 * Absolute path of the current artifact, for the offline scripts that load it
 * directly. Throws rather than returning nothing, because every caller's only
 * recourse is the same one sentence.
 */
export function indexArtifactPath(outDir: string): string {
  const manifest = readIndexManifest(outDir);
  if (manifest === null) {
    throw new Error(
      `No built Rhyme Index in ${outDir}. Run \`npm run build:index\` from the repo root.`,
    );
  }
  return resolve(outDir, manifest.index);
}

// --- Is the built artifact still current? --------------------------------------

/**
 * Every file `build-index.ts` reads, in the order that script reads them. Taken
 * from the code rather than from prose: this list is only useful if it is
 * complete, and a forgotten input is a fix that silently never ships.
 *
 * `data/schedule.json` is deliberately absent. It is read by the web bundle and
 * never by the Index (`bootPuzzle.ts` imports it into the bundle), so a Seed
 * Word swap needs a rebuild of the bundle and nothing else — which is the four
 * minutes this predicate exists to give back.
 *
 * Two of these (`words.txt`, `names.txt`) are gitignored and regenerable from
 * pinned upstream sources (ADR-0003), so on a fresh clone they may be absent
 * altogether. Absent counts as stale; see below.
 */
const DATA_INPUTS = [
  "sources.json",
  "cmudict.dict",
  "words.txt",
  "names.txt",
  "prevalence.csv",
  "demotions.txt",
  "supplement.dict",
];

/**
 * The build's own source counts as an input.
 *
 * #134 specified data inputs only, which leaves a hole: a change to the code
 * that manufactures the index is not a data change, so an edit to a
 * normalisation rule or an affix would ship a bundle whose judge predates it,
 * silently. That is the exact failure the err-toward-rebuilding bias exists to
 * prevent, so it is closed here rather than left to be discovered.
 *
 * The sweep is every module in `src/` plus the two scripts the build is made
 * of, rather than the import graph `build-index.ts` actually pulls in.
 * Resolving imports would be more precise and is the wrong trade: the cost of
 * over-reaching is an occasional unnecessary four minutes during development,
 * and the cost of under-reaching reaches players. `src/` is the engine, and
 * nearly all of it is in that graph already. The rest of `scripts/` is not —
 * the play REPL and the Editor's Pass cannot change a verdict — so it is left
 * out, and an editor reading tomorrow's Puzzle does not pay for a rebuild.
 */
const CODE_INPUTS = ["scripts/build-index.ts", "scripts/indexArtifact.ts"];
const CODE_INPUT_DIR = "src";
const CODE_INPUT_PATTERN = /\.ts$/;
const CODE_INPUT_SKIP = /^(__tests__|__fixtures__)$/;

/** Absolute paths of every input the built index depends on, present or not. */
export function indexInputs(root: string): string[] {
  return [
    ...DATA_INPUTS.map((name) => resolve(root, "data", name)),
    ...CODE_INPUTS.map((name) => resolve(root, name)),
    ...typeScriptFiles(resolve(root, CODE_INPUT_DIR)),
  ];
}

function typeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!CODE_INPUT_SKIP.test(entry.name)) found.push(...typeScriptFiles(resolve(dir, entry.name)));
    } else if (CODE_INPUT_PATTERN.test(entry.name)) {
      found.push(resolve(dir, entry.name));
    }
  }
  return found;
}

export interface IndexStaleness {
  stale: boolean;
  /** Null only when the artifact is current. */
  reason: "no-artifact" | "missing-input" | "input-newer" | null;
  /** The input that settled it, absolute, when an input did. */
  input?: string;
}

/**
 * Whether the built index needs rebuilding: is any input newer than the
 * artifact, or missing, or is there no artifact at all.
 *
 * **The two errors are not symmetric, and this is not neutral between them.** A
 * checkout or a re-save bumps a timestamp and costs a wasted four minutes. The
 * reverse — shipping a bundle whose judge lacks the fix just made — is silent
 * and reaches players, who have no way to see it. So anything unclear rebuilds:
 * a missing artifact, a missing input, an input whose timestamp merely ties.
 */
export function indexStaleness(root: string, outDir = resolve(root, "dist-data")): IndexStaleness {
  const manifest = readIndexManifest(outDir);
  if (manifest === null) return { stale: true, reason: "no-artifact" };
  const builtAt = statSync(resolve(outDir, manifest.index)).mtimeMs;

  for (const input of indexInputs(root)) {
    if (!existsSync(input)) return { stale: true, reason: "missing-input", input };
    // `>=` rather than `>`: a same-millisecond tie is unresolvable, and the tie
    // breaks toward rebuilding for the reason above.
    if (statSync(input).mtimeMs >= builtAt) return { stale: true, reason: "input-newer", input };
  }
  return { stale: false, reason: null };
}
