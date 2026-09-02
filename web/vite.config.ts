import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import {
  MANIFEST_FILENAME,
  UNBUILT_ARTIFACT_FILENAME,
  readIndexManifest,
} from "../scripts/indexArtifact.ts";
import { deployHeadersPlugin } from "./deployHeadersPlugin.ts";
import { indexAssetPlugin } from "./indexAssetPlugin.ts";
import { shareAssetPlugin } from "./shareAssetPlugin.ts";
import { editorAddPlugin } from "./editorAddPlugin.ts";
import { editorCandidatesPlugin } from "./editorCandidatesPlugin.ts";
import { editorCorrectionPlugin } from "./editorCorrectionPlugin.ts";
import { editorDayPlugin } from "./editorDayPlugin.ts";
import { editorDeclinePlugin } from "./editorDeclinePlugin.ts";
import { editorDemotionPlugin } from "./editorDemotionPlugin.ts";
import { editorEvidencePlugin } from "./editorEvidencePlugin.ts";
import { editorStatusPlugin } from "./editorStatusPlugin.ts";
import { editorTierPlugin } from "./editorTierPlugin.ts";
import { feedbackPlugin } from "./feedbackPlugin.ts";
import { supplementPlugin } from "./supplementPlugin.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const distDataDir = resolve(rootDir, "../dist-data");

/**
 * Where this build will be served from, for the absolute URLs a link card
 * requires (#196, #203).
 *
 * A share page's `og:image` and `og:url` cannot be relative — a scraper
 * resolves nothing — so somewhere has to know the hostname. That somewhere is
 * here, in the build's own configuration, and specifically *not* in
 * `src/share/shareTargets.ts`, which takes the origin as an argument and has a
 * test forbidding hostname literals. The distinction is the point of #196's
 * "build input rather than a hardcoded constant": the deployment's address is a
 * fact about the deployment, so it sits beside the rest of the deployment's
 * description rather than being baked into a module the bundle imports.
 *
 * The default is the playtest's address, the one `wrangler.jsonc` publishes on
 * — a default rather than a requirement because a build with no origin set is
 * the ordinary case (`npm run dev`, a local `npm run build`), and demanding a
 * variable of every build would cost each of them a check that only a deploy to
 * somewhere new actually needs. `SHARE_ORIGIN` overrides it, which is what makes
 * moving the deployment a change to the environment rather than to the source.
 *
 * What is *not* tolerated is an origin that is set and unusable. `SHARE_ORIGIN=`
 * or a bare hostname would sail through and produce relative `og:image` URLs —
 * a card with no badge, and no other symptom anywhere, discovered only by
 * sending one. So an override that is not an absolute http(s) URL stops the
 * build here, in the same spirit as the missing-index guard below.
 */
const DEPLOY_ORIGIN = "https://bramble-bee.kenna-dev.workers.dev";
const shareOrigin = resolveShareOrigin(process.env.SHARE_ORIGIN);

function resolveShareOrigin(override: string | undefined): string {
  if (override === undefined || override === "") return DEPLOY_ORIGIN;
  if (!/^https?:\/\/[^/]+/.test(override)) {
    throw new Error(
      `SHARE_ORIGIN must be an absolute http(s) URL, and is ${JSON.stringify(override)}. ` +
        "A share page's Open Graph tags need a hostname a scraper can fetch.",
    );
  }
  return override;
}

/**
 * The web shell. Rooted in `web/`, it resolves the engine's TypeScript source in
 * `../src` directly — Vite (via esbuild) reads the `.ts` imports with no engine
 * build step, so `src/` never gains a runtime dependency.
 *
 * The built index artifact (produced by `npm run build:index` at the repo root)
 * is served as a static asset from the site root, so the browser loader can
 * `fetch` it there. In development that is `publicDir` pointed at `dist-data`;
 * a build takes the named artifact and manifest only, via `indexAssetPlugin`,
 * because the rest of `dist-data` is diagnostics and probe scripts that have no
 * business on a public URL (#121).
 *
 * Its filename is content-addressed, and is **baked into the bundle here**, read
 * from the manifest at build time (#117). There is deliberately no runtime
 * manifest fetch: under a single deploy the bundle *is* the manifest, and a
 * runtime lookup would add a blocking round trip before the 14 MB index could
 * even start downloading, plus a second source of truth for which artifact is
 * current. ADR-0013 records the runtime fetch as the upgrade path to a split
 * deploy, at which point this constant becomes that `fetch`.
 */
export default defineConfig(({ command }) => {
  const manifest = readIndexManifest(distDataDir);

  // A production build with no index would ship a bundle that can never load
  // one, so it fails here rather than in a player's browser. `npm run dev`
  // carries on: a dev server that refuses to start is a worse answer than the
  // shell's existing index-load error state, which says what is wrong.
  if (manifest === null && command === "build") {
    throw new Error(
      `No ${MANIFEST_FILENAME} in ${distDataDir}. ` +
        "Run `npm run build:index` from the repo root before building the shell.",
    );
  }

  return {
    root: rootDir,
    // `feedbackPlugin`, `supplementPlugin` and the nine `editor*` plugins are
    // dev-only (`apply: "serve"`); `deployHeadersPlugin`, `indexAssetPlugin` and
    // `shareAssetPlugin` are build-only. Five of the editor plugins write to
    // `data/` — and `editorAddPlugin` and `editorCorrectionPlugin` also rebuild
    // `dist-data/` — which is why the build's
    // inputs are named below rather than defaulted. `editorStatusPlugin`,
    // `editorCandidatesPlugin` and `editorEvidencePlugin` are the three that
    // write nothing at all: the first reads the artifact's staleness and asks
    // git about the written files, and #162 gives the tool no commit and no
    // deploy to go with the answer; the second reads the Candidate Queue, whose
    // every state is derived rather than stored (#177); the third answers what
    // is true of a list of words against one Rhyme Key, and #186's rule is that
    // the pasted-list feature adds no new write path at all (#189).
    //
    // `shareAssetPlugin` writes the share feature's static assets — one landing
    // page and one rasterised Rank badge per Rank (#202, #203). It is the reason
    // the rasteriser and the display face it embeds are devDependencies:
    // generation is confined to build time, so neither the bundle nor the Worker
    // gains a rendering dependency, and no request renders anything. The origin
    // it takes is the only thing about those pages that is not derived.
    plugins: [
      react(),
      deployHeadersPlugin(),
      indexAssetPlugin(distDataDir),
      shareAssetPlugin(shareOrigin),
      editorDayPlugin(),
      editorStatusPlugin(),
      editorCandidatesPlugin(),
      editorTierPlugin(),
      editorDemotionPlugin(),
      editorDeclinePlugin(),
      editorEvidencePlugin(),
      editorCorrectionPlugin(),
      editorAddPlugin(),
      feedbackPlugin(),
      supplementPlugin(),
    ],
    build: {
      /**
       * The build's inputs, named rather than defaulted. `web/` holds a second
       * HTML entry point — `editor.html`, the Editor's Pass (ADR-0016) — which
       * the dev server serves and a production build must not contain: it reads
       * `data/`, and the later slices of the pass write it.
       *
       * Vite's default input is this same single `index.html`, so naming it
       * changes nothing about what is built today. What it changes is *why*
       * `editor.html` is excluded: by default it is excluded because nothing
       * happens to reference it, which is a fact about the absence of a line of
       * configuration and would be reversed by anyone adding a second entry for
       * an unrelated reason. Named, the deploy's contents are a list, and the
       * editor is off it — the same shape of guarantee, and for the same
       * reason, as `indexAssetPlugin`'s allow-list over `dist-data`.
       */
      rollupOptions: { input: resolve(rootDir, "index.html") },
    },
    // The deploy contains only runtime assets, so a build takes nothing from
    // `dist-data` wholesale — `indexAssetPlugin` names the two files that ship.
    // The dev server has no upload to pay for and keeps the whole directory.
    publicDir: command === "build" ? false : distDataDir,
    define: {
      __INDEX_ARTIFACT__: JSON.stringify(manifest?.index ?? UNBUILT_ARTIFACT_FILENAME),
    },
    server: {
      fs: {
        // The engine source lives above web/, so allow serving from the repo root.
        allow: [searchForWorkspaceRoot(rootDir)],
      },
    },
  };
});
