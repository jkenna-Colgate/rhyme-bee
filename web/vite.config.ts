import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * The web shell. Rooted in `web/`, it resolves the engine's TypeScript source in
 * `../src` directly — Vite (via esbuild) reads the `.ts` imports with no engine
 * build step, so `src/` never gains a runtime dependency.
 *
 * The built index artifact (`../dist-data/index.json`, produced by
 * `npm run build:index` at the repo root) is served as a static asset by
 * pointing `publicDir` at `dist-data`, so the browser loader can `fetch` it in
 * dev at `/index.json`.
 */
export default defineConfig({
  root: rootDir,
  plugins: [react()],
  publicDir: resolve(rootDir, "../dist-data"),
  server: {
    fs: {
      // The engine source lives above web/, so allow serving from the repo root.
      allow: [searchForWorkspaceRoot(rootDir)],
    },
  },
});
