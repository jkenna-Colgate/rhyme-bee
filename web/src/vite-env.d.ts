/// <reference types="vite/client" />

/**
 * Filename of the built Rhyme Index, content-addressed and baked in at build
 * time by `vite.config.ts` from the manifest `npm run build:index` writes
 * (#117). A constant, not a fetch — see the config for why.
 */
declare const __INDEX_ARTIFACT__: string;
