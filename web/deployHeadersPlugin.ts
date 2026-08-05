/**
 * Ship the deploy's cache directives with the build.
 *
 * `_headers` has to land at the root of the uploaded assets directory for
 * Cloudflare Workers static assets to read it, and Vite's one `publicDir` is
 * already spoken for by `../dist-data` (where the built index lives). So this
 * build-only plugin copies `web/_headers` into the output itself.
 *
 * The policy lives in `_headers` rather than here, in Cloudflare's own format,
 * because it is read by the deploy and by whoever is debugging a stale cache —
 * neither of whom should have to read a bundler plugin to find out what the
 * cache directives are.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const HEADERS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "_headers");

export function deployHeadersPlugin(): Plugin {
  return {
    name: "rhyme-bee-deploy-headers",
    // Dev serves from memory and has no cache to get wrong.
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: readFileSync(HEADERS_FILE, "utf8"),
      });
    },
  };
}
