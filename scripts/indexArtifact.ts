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
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Names the current artifact. Written by the build, read only at build time. */
export const MANIFEST_FILENAME = "index.manifest.json";

/**
 * Deliberately not `index-manifest.json`: the deploy's cache rule for hashed
 * artifacts is the glob `/index-*.json`, and the manifest is the one mutable
 * file of the set. Keeping it off that glob keeps it off the immutable cache.
 */
const ARTIFACT_PATTERN = /^index-[0-9a-f]+\.json$/;

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
 * it, then drop artifacts from earlier builds. The sweep is not tidiness: the
 * whole directory is the web build's `publicDir`, so a stale 15 MB index left
 * lying about is a stale 15 MB index uploaded on every deploy.
 */
export function writeIndexArtifact(outDir: string, contents: string): IndexManifest {
  const manifest = artifactName(contents);
  writeFileSync(resolve(outDir, manifest.index), contents);

  for (const name of readdirSync(outDir)) {
    if (ARTIFACT_PATTERN.test(name) && name !== manifest.index) rmSync(resolve(outDir, name));
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
