/**
 * The landing page behind a shared Rank, as HTML (#196, #203).
 *
 * A shared Rank is a URL, and a URL that unfurls into a card is a page with
 * Open Graph metadata in its head. This module is where every fact about that
 * card lives: what the title claims, which image the scraper fetches, and what
 * the page deliberately does not say. One place, because a card that says the
 * wrong thing is only discovered in somebody else's message thread.
 *
 * ## Timeless on purpose
 *
 * The page names no Seed Word, no date, no Score and no Answer. Two reasons,
 * and both are load-bearing:
 *
 * - A recipient may well intend to play today's Daily Puzzle themselves. A
 *   landing page that mentioned the day would spoil the game for the person the
 *   sender was trying to interest in it.
 * - Apple caches link previews aggressively and the URLs here never change, so
 *   a page that referred to a day would be wrong the day after and would stay
 *   wrong. Nothing on it can go stale because nothing on it is dated.
 *
 * ## No description
 *
 * There is no `og:description`, and its absence is a decision rather than an
 * oversight: the intended card is the badge, the title and the host beneath,
 * and a description would push a paragraph of prose into a graphic that is
 * meant to read as a trophy.
 *
 * ## No shared stylesheet
 *
 * The page is standalone: one `<style>` block, system font stacks, no bundle.
 * It is served to a recipient who has never played and may never load the game,
 * so it costs them nothing beyond the badge itself, and it cannot break when
 * the shell's CSS is next reworked.
 */

import { escapeMarkup } from "./escapeMarkup.ts";
import type { ShareTarget } from "./src/share/shareTargets.ts";
import { GAME_NAME } from "./src/brand.ts";

/**
 * What the game is, in one line, for somebody who has never seen it.
 *
 * Deliberately not the start gate's sentence, though it says the same thing:
 * that one addresses a player about to start and mentions how a turn goes,
 * where this one is answering "what is this?" for a stranger. Sharing a
 * constant would force one wording to serve both readers.
 */
const PREMISE =
  "A daily word puzzle: one word, and every word you can find that rhymes with it — " +
  "by sound, not spelling.";

/** The call into the game. The front page is the whole of the way in. */
const PLAY_LABEL = `Play ${GAME_NAME}`;

/**
 * One landing page, for one Rank.
 *
 * Every page on the ladder is this page. What differs between them is the badge
 * shown and the metadata in the head — there is no per-Rank copy, no ramp and
 * nothing else that varies, which is what makes renaming a Rank a rebuild
 * rather than an edit.
 */
export function renderSharePage(target: ShareTarget): string {
  const title = escapeMarkup(target.title);
  const label = escapeMarkup(target.label);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="canonical" href="${escapeMarkup(target.url)}" />

    <!-- The card. Absolute URLs throughout: a scraper resolves nothing.
         There is deliberately no og:description, and no og:site_name either —
         the host reads underneath the card on its own, and naming the site
         would only replace it with the same words. -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:image" content="${escapeMarkup(target.badgeUrl)}" />
    <meta property="og:image:alt" content="${label}" />
    <meta property="og:url" content="${escapeMarkup(target.url)}" />
    <!-- iMessage reads the Open Graph tags above and ignores this one. It is
         here for the destinations that would otherwise fall back to a thumbnail
         beside a line of text, which is the one shape this card must not take. -->
    <meta name="twitter:card" content="summary_large_image" />

    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 2rem 1.25rem;
        box-sizing: border-box;
        background: #f7f2e7;
        color: #2c2a26;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        text-align: center;
      }
      img { width: min(100%, 32rem); height: auto; }
      p { margin: 0; max-width: 32rem; font-size: 1.05rem; line-height: 1.5; }
      a {
        display: inline-block;
        padding: 0.75rem 1.75rem;
        border-radius: 999px;
        background: #2c2a26;
        color: #f7f2e7;
        font-size: 1.05rem;
        font-weight: 600;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <img src="${escapeMarkup(target.badgePath)}" alt="${label}" />
    <p>${escapeMarkup(PREMISE)}</p>
    <a href="/">${escapeMarkup(PLAY_LABEL)}</a>
  </body>
</html>
`;
}
