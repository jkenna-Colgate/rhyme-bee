# Rhyming Bee — web shell

The playable browser shell over the pure rhyme engine in [`../src`](../src). It
is a Vite + React app and holds the repo's only runtime dependencies; the engine
stays pure and dependency-free (Vite resolves its `.ts` source directly, with no
engine build step).

## Run it

```sh
# 1. From the repo root, build the index artifact the shell fetches (~14 MB).
npm run build:index          # writes dist-data/index-<hash>.json

# 2. Install the shell's deps and start the dev server.
cd web
npm install
npm run dev                  # opens the shell in a browser
```

The dev server serves `../dist-data` as static files, so the browser loader
fetches the built index from the site root. If you see the error state, you most
likely skipped step 1.

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — production build into `web/dist`.
- `npm run typecheck` — type-check the shell (`tsc --noEmit`).
- `npm run deploy` — publish `web/dist` and the Worker as one version. Normally
  reached as `npm run deploy` from the repo root, which builds the index first;
  see [docs/deploy.md](../docs/deploy.md).
- `npm run deploy:dry-run`, `npm run deployments`, `npm run rollback` — see what
  would go up, list recent versions, put the previous one back.

## What the build publishes

`web/dist` is the uploaded assets directory, and it holds only what the running
game needs: `index.html`, `assets/*`, `_headers`, the current
`index-<hash>.json` and `index.manifest.json`.

The dev server reaches the index through `publicDir`, which is the whole of
`../dist-data` — but a **build takes a named list out of that directory instead**
(`indexAssetPlugin.ts`), because `dist-data` is a working directory as much as a
build output. The drop and derivation reports live there, and so does every probe
script written while chasing a rhyme bug; publishing the directory wholesale put
34 MB at a public URL, some 20 MB of it diagnostics and repo internals. An
allow-list rather than a deny-list, so the next probe script is out of the deploy
by default instead of having to be remembered.

## The index artifact, the manifest, and caching

The built index is **immutable and content-addressed**: `npm run build:index`
writes it as `dist-data/index-<hash>.json`, hashed over its own contents, and
writes `dist-data/index.manifest.json` naming the current one. The maintainer
rebuilds the judge and redeploys daily during the playtest, and this is what
makes that loop both invisible-proof and verifiable — a rebuilt judge is a new
filename, so it can be cached forever and still reach every browser on the next
deploy, and the filename says exactly which judge a given player saw.

`vite.config.ts` reads the manifest **at build time** and bakes the filename into
the bundle as `__INDEX_ARTIFACT__`. There is no runtime manifest fetch, by
decision: under a single deploy the bundle *is* the manifest, so a lookup would
only add a blocking round trip in front of the download that actually matters,
and a second source of truth for which artifact is current.

**`index.manifest.json` is therefore generated but intentionally unused by the
client — and that is correct. It is not dead code.** It is the documented
upgrade path (ADR-0013) to a split deploy, where the index and the bundle ship
separately and the index can be swapped without rebuilding the shell. Adopting
it is turning one constant into a `fetch`; the content-addressed naming, which
is the part that is genuinely annoying to retrofit, is already done. Do not
delete the manifest, and do not wire a runtime fetch to it today.

Cache directives are declared explicitly by the deployment in [`_headers`](./_headers)
— immutable and long-lived for the hashed artifact and the hashed bundle assets,
revalidated for the entry point — rather than inherited from host defaults.
`deployHeadersPlugin.ts` copies that file into `web/dist` on build, so it sits at
the root of the uploaded assets directory where Cloudflare Workers reads it.
