/**
 * The deployed Worker. It serves the game's static assets and answers the
 * out-of-band reporting endpoints on the same origin, so there is no second
 * hostname and no CORS to get wrong.
 *
 * Routing is a short list of known paths; everything else is the game, handed
 * straight to the asset binding — and, in the one case below, handed to it
 * twice, so that a link sent weeks ago to a Rank since renamed lands on the
 * front page rather than a 404. Cloudflare only runs this Worker for a request
 * no asset matches, so the ordinary business of loading the game does not pass
 * through here at all — and if an endpoint is broken or the bucket is gone, the
 * game is unaffected, because judging happens in the browser (ADR-0013).
 *
 * This file is a routing table on purpose. A new endpoint is a line here plus a
 * handler of its own; the handlers do not know about each other.
 */

import { FEEDBACK_PATH, APPEAL_PATH } from "../src/endpoints.ts";
import { SHARE_PATH_PREFIX } from "../src/share/shareTargets.ts";
import { handleFeedback } from "./feedbackRoute.ts";
import { handleAppeal } from "./appealRoute.ts";
import type { Env } from "./env.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === APPEAL_PATH) return handleAppeal(request, env);
    if (pathname === FEEDBACK_PATH) return handleFeedback(request, env);

    const response = await env.ASSETS.fetch(request);

    /**
     * A share page that no build ever wrote lands on the game's front page
     * rather than a 404 (#196, #203).
     *
     * The share pages are named after the Ranks, and Ranks get renamed —
     * `Sonneteer` was dropped from the ladder in #195 while this feature was
     * being built. A message thread is the one place a link cannot be edited
     * after the fact, so every URL ever sent has to keep working, and "keep
     * working" here means landing somewhere that explains the game rather than
     * on an error page from a stranger's puzzle.
     *
     * This is not a route. Nothing is rendered, no endpoint exists at the share
     * prefix, and a page the build *did* write is served by the assets before
     * this line is reached — Cloudflare only runs this Worker for a request no
     * asset matches. It is deliberately narrow rather than
     * `not_found_handling: "single-page-application"` in `wrangler.jsonc`, which
     * would turn every 404 on the origin into a 200 carrying the shell,
     * including a missing Rhyme Index artifact: that would replace the loader's
     * "could not fetch the index (404)" with a JSON parse error on a page of
     * HTML, which is a worse answer to the deploy's most important failure.
     */
    if (response.status === 404 && pathname.startsWith(SHARE_PATH_PREFIX)) {
      return env.ASSETS.fetch(new Request(new URL("/", url)));
    }

    return response;
  },
};
