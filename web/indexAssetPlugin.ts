/**
 * Put the built Rhyme Index into the deploy — and nothing else from beside it.
 *
 * `dist-data/` is a working directory as much as a build output: the index and
 * its manifest land there, but so do the drop and derivation reports, and so
 * does every probe and measurement script anyone has ever written while chasing
 * a rhyme bug. Vite's `publicDir` copies a directory wholesale, so pointing it
 * at `dist-data` (as the shell did up to #121) published all of that — 34 MB of
 * upload, of which some 20 MB was diagnostics, repo internals and a stale
 * pre-#117 `index.json` sitting at a public URL as a second, different judge.
 *
 * So the build does not copy the directory. It copies a **named list**, and that
 * direction matters: an allow-list means the next probe script written in
 * `dist-data` is absent from the deploy by default, where a deny-list of today's
 * diagnostics would quietly readmit it. The list is exactly what the running
 * game needs to be served, which is the artifact — and the manifest, which
 * nothing fetches today but which is the upgrade path to a split deploy
 * (ADR-0013), and so must be published beside the artifact it names.
 *
 * Development is unaffected: `npm run dev` still serves `dist-data` through
 * `publicDir`, because a dev server has no upload cost and reaching a report
 * from the browser is occasionally useful. This plugin is build-only.
 */

import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { MANIFEST_FILENAME, readIndexManifest } from "../scripts/indexArtifact.ts";

/**
 * What `dist-data/` is allowed to contribute to a deploy, by name.
 *
 * Empty when no index has been built. The production build refuses before it
 * reaches here (see `vite.config.ts`), so an empty list means a dev-mode caller.
 */
export function publishedIndexFiles(distDataDir: string): string[] {
  const manifest = readIndexManifest(distDataDir);
  return manifest === null ? [] : [manifest.index, MANIFEST_FILENAME];
}

export function indexAssetPlugin(distDataDir: string): Plugin {
  return {
    name: "rhyme-bee-index-asset",
    apply: "build",
    // `writeBundle`, not `generateBundle`: the artifact is 15 MB, and there is
    // nothing to be gained by reading it into memory and handing it to rollup
    // when the file already exists on disk in its final form.
    writeBundle(options) {
      const outDir = options.dir;
      if (outDir === undefined) return;
      for (const name of publishedIndexFiles(distDataDir)) {
        copyFileSync(resolve(distDataDir, name), resolve(outDir, name));
      }
    },
  };
}
