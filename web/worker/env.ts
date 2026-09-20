/**
 * What the deployed Worker is handed at runtime. Every entry here is a
 * **binding** declared in the committed `wrangler.jsonc` — never a dashboard
 * binding, which a deploy from a config that does not declare it silently
 * clobbers, and never an access key, because a binding hands the Worker the
 * bucket directly and leaves no credential anywhere on the write path.
 *
 * The shapes are the structural subset this Worker actually uses, rather than
 * `@cloudflare/workers-types`. That package redeclares `Request`, `Response` and
 * friends, which collides with the DOM lib the web package compiles against;
 * a handful of methods, written down, cost less than reconciling two global
 * environments for the one file that needs them.
 */

/** The static assets the same Worker serves — the game itself. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** The R2 bucket an Appealed word is written to, one object per Appeal. */
export interface AppealBucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

/**
 * A rate limiter, as the platform's simple rate-limiting binding presents one:
 * ask whether a key is still under its budget, and get back whether it is. The
 * limit and the window are declared in `wrangler.jsonc`, not here, so the
 * Worker never restates them.
 *
 * Deliberately permissive and eventually consistent, and counted per Cloudflare
 * location rather than globally — so the real ceiling is the configured number
 * times however many locations an attacker reaches. That is a fact about the
 * platform, and the reason the numbers in `wrangler.jsonc` are chosen to make
 * abuse pointless rather than to meter anything exactly.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** `assets.binding` in `wrangler.jsonc`. */
  ASSETS: AssetsBinding;
  /** `APPEAL_QUEUE` → the `rhyme-bee-flags` bucket (#114). */
  APPEAL_QUEUE: AppealBucket;
  /**
   * The two write endpoints' budgets (#213). Separate bindings with separate
   * namespaces on purpose: a junk Appeal costs an R2 object, while a junk note
   * files an issue on a public repository using the maintainer's token, and one
   * shared budget would let either abuse starve the other.
   */
  APPEAL_LIMITER: RateLimiter;
  FEEDBACK_LIMITER: RateLimiter;
  /**
   * `owner/repo` of the tracker a general note is filed on — a plaintext `var`
   * in `wrangler.jsonc`, because which tracker this game reports to is not a
   * secret and belongs beside the config it is deployed with.
   */
  ISSUE_REPO: string;
  /**
   * The credential that files that issue: a fine-grained token scoped to Issues
   * on that one repository (#114, Step 6). It is a **secret**, set with
   * `wrangler secret put GITHUB_ISSUE_TOKEN --name bramble-bee` and never
   * declared in the committed `wrangler.jsonc`.
   *
   * Optional on purpose. `wrangler secret put` reads stdin, and run anywhere
   * stdin is closed it uploads an empty string and reports success (#114's
   * gotcha, hit for real). An unset or empty token is therefore a live state,
   * and the route says so rather than letting it arrive as an opaque 401.
   */
  GITHUB_ISSUE_TOKEN?: string;
}
