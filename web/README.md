# Rhyme Bee — web shell

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
