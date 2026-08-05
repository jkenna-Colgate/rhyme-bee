/**
 * The deployed Worker. It serves the game's static assets and answers the
 * out-of-band reporting endpoints on the same origin, so there is no second
 * hostname and no CORS to get wrong.
 *
 * Routing is a short list of known paths; everything else is the game, handed
 * straight to the asset binding. Cloudflare only runs this Worker for a request
 * no asset matches, so the ordinary business of loading the game does not pass
 * through here at all — and if an endpoint is broken or the bucket is gone, the
 * game is unaffected, because judging happens in the browser (ADR-0013).
 *
 * This file is a routing table on purpose. A new endpoint is a line here plus a
 * handler of its own; the handlers do not know about each other.
 */

import { FLAG_PATH } from "../src/endpoints.ts";
import { handleFlag } from "./flagRoute.ts";
import type { Env } from "./env.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === FLAG_PATH) return handleFlag(request, env);

    return env.ASSETS.fetch(request);
  },
};
