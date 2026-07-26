# Rhyme Bee — web shell

The playable browser shell over the pure rhyme engine in [`../src`](../src). It
is a Vite + React app and holds the repo's only runtime dependencies; the engine
stays pure and dependency-free (Vite resolves its `.ts` source directly, with no
engine build step).

## Run it

```sh
# 1. From the repo root, build the index artifact the shell fetches (~14 MB).
npm run build:index          # writes dist-data/index.json

# 2. Install the shell's deps and start the dev server.
cd web
npm install
npm run dev                  # opens the shell in a browser
```

The dev server serves `../dist-data` as static files, so the browser loader
fetches the built index at `/index.json`. If you see the error state, you most
likely skipped step 1.

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — production build into `web/dist`.
- `npm run typecheck` — type-check the shell (`tsc --noEmit`).
