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
 * is left here — map, write, check — is deliberately untested, because a test
 * over it would be a test of Vite's hook order.
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { renderBadge } from "./badgeRenderer.ts";
import { shareTargets } from "./src/share/shareTargets.ts";

/**
 * Emit the badges under `outDir`, and confirm every rung got one.
 *
 * The check is the point of the ticket: a rung whose badge never landed is a
 * Rank a player can reach and cannot share, and the failure would otherwise
 * surface as a broken image in somebody's message thread weeks later. Here it
 * stops the build, which is the only place anyone is looking.
 */
export function writeShareBadges(outDir: string, origin: string): string[] {
  const targets = shareTargets(DEFAULT_SCORING_CONFIG.rankLadder, origin);

  for (const target of targets) {
    const file = resolve(outDir, target.badgeFile);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderBadge(target.label));
  }

  const missing = targets.filter((target) => {
    try {
      return !statSync(resolve(outDir, target.badgeFile)).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    throw new Error(
      "No badge was written for " +
        missing.map((target) => `${target.label} (${target.badgeFile})`).join(", ") +
        ". A Rank without a badge is a Rank that cannot be shared.",
    );
  }

  return targets.map((target) => target.badgeFile);
}

/**
 * The origin is a build input rather than a constant here, so a hostname is
 * never baked into a module by accident. Badge filenames do not depend on it —
 * only the absolute URLs a link card needs do, and those arrive with the pages
 * in #203, which is where an unset origin will have to become a build failure.
 */
export function shareAssetPlugin(origin: string): Plugin {
  return {
    name: "rhyme-bee-share-assets",
    apply: "build",
    // `writeBundle`, not `generateBundle`: these are files beside the bundle
    // rather than part of it, which is the same call `indexAssetPlugin` makes.
    writeBundle(options) {
      const outDir = options.dir;
      if (outDir === undefined) return;
      writeShareBadges(outDir, origin);
    },
  };
}
