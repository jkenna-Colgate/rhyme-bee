/**
 * The act of sharing a Rank, with no view attached: a Rank in, the outcome of
 * sharing it out (#196, #204).
 *
 * Two browsers, two gestures. Where there is a native share sheet the URL goes
 * into it and the player picks a destination; where there is not — most desktop
 * browsers — it goes onto the clipboard instead, because sharing that worked
 * only on a phone would be sharing that half the players cannot do. The caller
 * is told which happened, since the two need different confirmations: a share
 * sheet is its own feedback and a silent clipboard write is not.
 *
 * ## Why the browser arrives as arguments
 *
 * `navigator.share` and `navigator.clipboard` are the branch condition, and code
 * that reads them for itself can only be tested in whichever browser the suite
 * happens to run in — which would leave the fallback path, the one that exists
 * *because* environments differ, covered in exactly one environment. They arrive
 * as parameters instead. That is also why this is a module and not a handler
 * inside `PuzzleView`: the view is untested by convention, and these branches
 * are the feature.
 *
 * ## What this cannot do
 *
 * Nothing here can touch a Session. It is handed a Rank's label and a ladder,
 * and has no access to the Session, the Answers, or anything that could end or
 * alter a Puzzle — sharing is not a Reveal, and a player who shares mid-Puzzle
 * plays on. It cannot disclose anything either: the URL it sends names a Rank
 * and nothing else, so no date, Seed Word or Score leaves the tab.
 *
 * The URL itself is neither built nor looked up here. Both are `shareTargets`'
 * work, the same projection the build maps over to decide which files to write,
 * so a link this module sends is a link some file exists for.
 */

import type { RankTier } from "../../../src/scoring.ts";
import { shareTargetFor } from "./shareTargets.ts";

/**
 * The only thing about the player's Rank that sharing needs: what it is called.
 *
 * Deliberately narrower than the engine's `Rank`, which a caller may pass
 * unchanged. The Score behind the Rank, and how much of the Puzzle it leaves
 * unfound, are not this module's business and are not in its reach.
 */
export interface ShareableRank {
  label: string;
}

/**
 * Everything sharing needs from outside itself.
 *
 * Two of these describe the deployment and two describe the browser, and they
 * are one bag rather than two because a caller has to supply all four in the
 * same breath and no case wants a subset. The browser's two are optional
 * because both are genuinely absent somewhere: a desktop browser may have no
 * share sheet, and a page served over plain HTTP has no clipboard. A caller
 * passes `navigator.share` and `navigator.clipboard.writeText`, each bound, and
 * leaves out whichever this browser lacks.
 */
export interface ShareContext {
  /** Where this build is served from, for the absolute URL the card needs. */
  origin: string;
  /** The Rank ladder the player's Rank came from. */
  ladder: RankTier[];
  /** The native share sheet, where the browser has one. */
  share?: (data: { url: string }) => Promise<void>;
  /** Writing to the clipboard, the fallback where it does not. */
  copy?: (text: string) => Promise<void>;
}

/**
 * What happened, in the four forms a control has to confirm differently.
 *
 * `dismissed` is distinct from `failed` because a player who opened the sheet
 * and backed out chose that, and telling them something went wrong would be
 * wrong. `failed` is the only one that needs an apology, and it stays a value
 * rather than a thrown error: a control that explodes mid-Puzzle over a refused
 * clipboard would be a worse bug than the one it is reporting.
 */
export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

/**
 * Share the URL for a Rank, however this browser can.
 *
 * A Rank the ladder does not hold is a Rank the build wrote no page for, so
 * nothing is sent at all rather than a link that resolves to nothing.
 */
export async function shareRank(
  rank: ShareableRank,
  context: ShareContext,
): Promise<ShareOutcome> {
  const { origin, ladder, share, copy } = context;
  const target = shareTargetFor(ladder, origin, rank.label);
  if (target === undefined) return "failed";

  if (share !== undefined) {
    try {
      // The bare URL alone. A title and a description belong to the page's own
      // Open Graph metadata, and text accompanying a link can stop a destination
      // unfurling it at all — which would send the claim without the badge.
      await share({ url: target.url });
      return "shared";
    } catch (error) {
      // A cancelled sheet rejects like a failure and is not one.
      if (isAbort(error)) return "dismissed";
      // Anything else — a share sheet the browser advertised and then refused —
      // still leaves the clipboard worth trying, so the player is left with the
      // link rather than with nothing.
    }
  }

  if (copy === undefined) return "failed";
  try {
    await copy(target.url);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * Whether a rejection is the player closing the share sheet.
 *
 * `AbortError` is the Web Share API's own convention rather than anything this
 * module can enforce, which is the one place the injected capability is assumed
 * to behave like the browser's. A share sheet that signalled a cancel some other
 * way would fall through to the clipboard and report `copied` — the player would
 * be handed a link they did not ask for, which is the harmless direction to be
 * wrong in.
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
