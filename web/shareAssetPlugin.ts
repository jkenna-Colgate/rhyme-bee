/**
 * Write one Rank badge into the deploy per rung of the ladder (#196, #202).
 *
 * A shared Rank is a link card, and a link card points at an image on a URL. The
 * badge set is finite and known before anyone plays: the badge carries the Rank
 * name and nothing else, so there are exactly as many badges as there are rungs.
 * They are therefore generated here, once, at build time, and shipped as static
 * assets — no request renders anything, no rendering dependency reaches the
 * Worker, and nothing generated is committed.
 *
 * The plugin is thin wiring, in the shape `indexAssetPlugin` already uses: the
 * work is `shareTargets` deciding what the files are called and `renderBadge`
 * deciding what they contain, both of which live in modules of their own. What
 * is left here — map and write — is untested, because a test over it would be a
 * test of Vite's hook order. That is not the repo's older "transport is
 * untested" convention, which lost: as with `indexAssetPlugin`'s
 * `publishedIndexFiles`, the decision is exported and covered elsewhere, and
 * only the hook is left bare.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { renderBadge } from "./badgeRenderer.ts";
import { shareTargets } from "./src/share/shareTargets.ts";

/**
 * Emit one badge per rung under `outDir`.
 *
 * There is no existence check after the loop. An earlier draft stat'd the files
 * it had just written, which could only fail if the filesystem lied — the guard
 * the ticket asks for belongs where the badge can actually come out wrong, and
 * that is in the renderer: a Rank that sets no visible label throws there and
 * takes the build down with it, rather than shipping an empty seal.
 *
 * The origin is empty because a badge filename does not depend on one. The
 * absolute URLs a link card needs arrive with the pages in #203, which is where
 * a real origin has to be supplied and an unset one has to fail the build; a
 * hostname threaded through here today would do no work and prove nothing.
 */
export function writeShareBadges(outDir: string): void {
  for (const target of shareTargets(DEFAULT_SCORING_CONFIG.rankLadder, "")) {
    const file = resolve(outDir, target.badgeFile);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderBadge(target.label));
  }
}

export function shareAssetPlugin(): Plugin {
  return {
    name: "rhyme-bee-share-assets",
    apply: "build",
    // `writeBundle`, not `generateBundle`: these are files beside the bundle
    // rather than part of it, which is the same call `indexAssetPlugin` makes.
    writeBundle(options) {
      const outDir = options.dir;
      if (outDir === undefined) return;
      writeShareBadges(outDir);
    },
  };
}
