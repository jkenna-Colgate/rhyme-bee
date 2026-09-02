/// <reference types="vite/client" />

/**
 * Filename of the built Rhyme Index, content-addressed and baked in at build
 * time by `vite.config.ts` from the manifest `npm run build:index` writes
 * (#117). A constant, not a fetch — see the config for why.
 */
declare const __INDEX_ARTIFACT__: string;

/**
 * Origin of the deploy whose build wrote the share pages (#196, #201), baked in
 * by `vite.config.ts` from `SHARE_ORIGIN`. Only the dev server reads it: a
 * production bundle links to its own host instead — see `PuzzleView`.
 */
declare const __SHARE_ORIGIN__: string;
