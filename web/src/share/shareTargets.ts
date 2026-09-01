/**
 * One share target per Rank on the ladder: the projection both halves of
 * the share feature read, and the reason they cannot disagree (#196, #201).
 *
 * A player who reaches a Rank can send it as a link that unfurls into a card
 * carrying a badge. Open Graph metadata belongs to a *URL* — one address can
 * only ever return one title and one image — so there is a page and a badge per
 * Rank, both generated at build time and shipped as static assets. Two quite
 * separate pieces of code therefore have to agree on the same strings: the build
 * maps over these targets to decide what files to write, and the browser looks
 * one up to decide what URL to put in the composer.
 *
 * That agreement is the whole point of this module. If the two derived their
 * paths independently they could drift, and the drift would be invisible: a link
 * pointing at a file the build never wrote typechecks, passes the suite, and
 * fails for the first time in somebody's message thread, weeks later. So neither
 * side is allowed to know how a path is spelled. They map over this.
 *
 * ## What is deliberately not here
 *
 * **No origin.** The absolute URLs a link card requires need a hostname, and a
 * hostname written here would be baked into the bundle by accident on the first
 * day the deployment moved. It arrives as an argument, from the build, and this
 * module is checked for hostname literals by its own test.
 *
 * **No ladder.** The caller supplies one. The Rank ladder is a knob on
 * `ScoringConfig` rather than a constant, and although nothing overrides it
 * today, a projection that quietly assumed the shipped labels would be a guard
 * that stops guarding the moment something does.
 *
 * **Nothing from the rhyme engine but a type.** `RankTier` is imported and
 * nothing is given back: `src/` gains no knowledge of URLs or images.
 */

import type { RankTier } from "../../../src/scoring.ts";
import { GAME_NAME } from "../brand.ts";

/** Where the generated pages and badges live, under the build output root. */
const SHARE_DIR = "share";

/**
 * Everything the build and the browser must agree on for one Rank.
 *
 * The file fields and the path fields say the same thing twice on purpose: the
 * build writes `pageFile`, the browser asks for `pagePath`, and holding both
 * here means the leading slash is added in exactly one place rather than at each
 * call site that happens to need the other form.
 */
export interface ShareTarget {
  /** The Rank's identifier in a URL — unique across the ladder, and URL-safe. */
  slug: string;
  /** The label, passed through exactly as the ladder spells it. */
  label: string;
  /** The claim the card makes, and the only place the Rank is stated in words. */
  title: string;
  /** The landing page, relative to the build output root. */
  pageFile: string;
  /** The badge image, relative to the build output root. */
  badgeFile: string;
  /** The landing page as the browser requests it. */
  pagePath: string;
  /** The badge as a scraper requests it. */
  badgePath: string;
  /** The absolute landing-page URL: the one string the composer receives. */
  url: string;
  /** The absolute badge URL, which is the form Open Graph metadata requires. */
  badgeUrl: string;
}

/**
 * Reduce a label to something that can sit in a path.
 *
 * Readability is the only reason to slug at all rather than number the Ranks:
 * the slug is invisible in a rendered card, and visible only in the composer
 * before sending and in destinations that do not unfurl links — where the
 * recipient is looking at a bare URL with no badge either way, and a legible one
 * is a small mercy.
 *
 * Apostrophes are dropped rather than hyphenated, so a possessive reads as one
 * word. Everything else that is not a letter or a digit becomes a separator.
 */
function slugify(label: string): string {
  return label
    .normalize("NFKD")
    // Strip the combining marks NFKD just split off, so `Trouvère` slugs as
    // `trouvere` rather than losing the whole syllable to the separator rule.
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The projection. One target per Rank, in ladder order, for any ladder at all.
 *
 * Totality is the property that matters and it is unconditional: this never
 * throws and never skips a Rank, because the alternative is a Rank a player can
 * reach and cannot share. A label that slugs to nothing — punctuation, a script
 * with no Latin form, the empty string — falls back to its position on the
 * ladder, and a slug already taken by an earlier Rank is suffixed until it is
 * free. Both cases produce an ugly URL for a ladder nobody has written; neither
 * produces a missing badge.
 */
export function shareTargets(ladder: RankTier[], origin: string): ShareTarget[] {
  const root = origin.replace(/\/+$/, "");
  const taken = new Set<string>();

  return ladder.map((rank, index) => {
    const base = slugify(rank.label) || `rank-${index + 1}`;
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);

    const pageFile = `${SHARE_DIR}/${slug}.html`;
    const badgeFile = `${SHARE_DIR}/${slug}.png`;

    return {
      slug,
      label: rank.label,
      title: `I got ${rank.label} in ${GAME_NAME}`,
      pageFile,
      badgeFile,
      pagePath: `/${pageFile}`,
      badgePath: `/${badgeFile}`,
      url: `${root}/${pageFile}`,
      badgeUrl: `${root}/${badgeFile}`,
    };
  });
}
