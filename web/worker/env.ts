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

/** The R2 bucket a flagged word is written to, one object per flag. */
export interface FlagBucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export interface Env {
  /** `assets.binding` in `wrangler.jsonc`. */
  ASSETS: AssetsBinding;
  /** `FLAG_QUEUE` → the `rhyme-bee-flags` bucket (#114). */
  FLAG_QUEUE: FlagBucket;
}
