/**
 * Write the share feature's static assets into the deploy: one landing page and
 * one badge per Rank on the ladder (#196, #202, #203).
 *
 * A shared Rank is a link card, a link card belongs to a URL, and Open Graph
 * metadata belongs to a URL too — so there is a page per Rank as well as an
 * image. Both sets are finite and known before anyone plays: page and badge
 * carry the Rank name and nothing else, so there are exactly as many of each as
 * there are Ranks. They are therefore generated here, once, at build time, and
 * shipped as static assets — no request renders anything, no rendering
 * dependency reaches the Worker, and nothing generated is committed. Because
 * they land beside the bundle and the Rhyme Index, one deploy carries the whole
 * version atomically.
 *
 * The plugin is thin wiring, in the shape `indexAssetPlugin` already uses: the
 * work is `shareTargets` deciding what the files are called and `renderBadge`
 * and `renderSharePage` deciding what they contain, each in a module of its
 * own. What is left here — map and write — is untested, because a test over it
 * would be a test of Vite's hook order. That is not the repo's older "transport is
 * untested" convention, which lost: as with `indexAssetPlugin`'s
 * `publishedIndexFiles`, the decision is exported and covered elsewhere, and
 * only the hook is left bare.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { renderBadge } from "./badgeRenderer.ts";
import { renderSharePage } from "./sharePageRenderer.ts";
import { shareTargets } from "./src/share/shareTargets.ts";

/**
 * Emit one landing page and one badge per Rank under `outDir`.
 *
 * There is no existence check after the loop. An earlier draft stat'd the files
 * it had just written, which could only fail if the filesystem lied — the guard
 * the ticket asks for belongs where an asset can actually come out wrong, and
 * that is in the renderer: a Rank that sets no visible label throws there and
 * takes the build down with it, rather than shipping an empty seal.
 *
 * The origin is a parameter and has no default, because the absolute URLs a
 * link card requires are the one thing here that a wrong value corrupts
 * silently: a page whose `og:image` points at the wrong host renders as a card
 * with no badge, and nothing short of sending one would say so. It arrives from
 * `vite.config.ts`, which is where the deployment is described.
 */
export function writeShareAssets(outDir: string, origin: string): void {
  for (const target of shareTargets(DEFAULT_SCORING_CONFIG.rankLadder, origin)) {
    writeAsset(resolve(outDir, target.badgeFile), renderBadge(target.label));
    writeAsset(resolve(outDir, target.pageFile), renderSharePage(target));
  }
}

/** Write one generated asset, creating the share directory the first time. */
function writeAsset(file: string, contents: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

export function shareAssetPlugin(origin: string): Plugin {
  return {
    name: "rhyme-bee-share-assets",
    apply: "build",
    // `writeBundle`, not `generateBundle`: these are files beside the bundle
    // rather than part of it, which is the same call `indexAssetPlugin` makes.
    writeBundle(options) {
      const outDir = options.dir;
      if (outDir === undefined) return;
      writeShareAssets(outDir, origin);
    },
  };
}
