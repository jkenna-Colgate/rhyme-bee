/**
 * The dev-only endpoint the Editor's Pass reads its own state through (#162). A
 * Vite plugin that, during `npm run dev` only (`apply: "serve"`, so
 * `configureServer` never runs in a production build), answers `GET` on
 * `/api/editor/status` with two facts: whether the built Rhyme Index is stale,
 * and whether each file the tool writes carries uncommitted changes.
 *
 * ## Status, and nothing but
 *
 * This route writes nothing — not to `data/`, not to `dist-data/`, not to
 * `.git`. So does the day route beside it; what is particular here is *what it
 * declines to write given what it reads*. It is the one route that knows a
 * night's work is sitting uncommitted, and it grows no button for that
 * knowledge. The sequence stays *judge, read the diff, commit, deploy*, and the
 * tool's part in it ends at the first comma. There is no
 * commit affordance and no deploy affordance here or anywhere in the pass, and
 * the reasoning for reading git without ever running it is
 * `web/workingTree.ts`'s doc comment, which is where a reader looking for the
 * contradiction in #162's acceptance criteria should be sent.
 *
 * ## Why the staleness answer is not computed here
 *
 * `indexStaleness` (`scripts/indexArtifact.ts`) is the build's own predicate,
 * and this screen asks it the same question the build does. A second staleness
 * rule written for the editor is the kind of near-duplicate that agrees for a
 * year and then does not — and the case it would disagree on is the one that
 * matters, because `OPTIONAL_DATA_INPUTS` there is *already* the carve-out that
 * makes an Editor's Pass's own output behave correctly: a missing
 * `data/tier-overrides.csv` is a legitimate no-op rather than a permanent
 * rebuild, and an existing one newer than the artifact is stale exactly like
 * any other input. That second half is what makes a night of Tier verdicts
 * enable Submit; it is held to account in
 * `scripts/__tests__/indexArtifact.test.ts`.
 *
 * ## Why nothing here has a request module
 *
 * The other four routes each have one, holding what counts as a request and
 * what size of body will be read. This route has no request to speak of — no
 * date, no words, no verdict — so a module of its own would hold one constant
 * and no decision. The cap below is declared here for that reason and argues
 * itself in place.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { indexStaleness, type IndexStaleness } from "../scripts/indexArtifact.ts";
import { indexStatus, porcelainCodes, writtenStatus } from "./editorStatusReport.ts";
import { readCappedBody, sendJson } from "./editorTransport.ts";
import { EDITOR_STATUS_PATH } from "./src/endpoints.ts";
import { WRITTEN_FILES, type EditorStatus } from "./src/editor/status.ts";
import { uncommittedPorcelain } from "./workingTree.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A status read names nothing and carries no body, so this is not a size the
 * endpoint expects to use — it is the answer to a body that arrives anyway,
 * which connect hands a middleware as a live stream whether or not it was
 * asked for. 512 bytes is `editorDayRequest.ts`'s number for the same
 * situation, arrived at independently and for the same reason rather than
 * imported: a shared cap would mean a change to either route being reasoned
 * about as a change to both, which is the argument `web/editorTransport.ts`
 * makes for keeping the constants apart while sharing the reader.
 */
const MAX_STATUS_BODY_BYTES = 512;

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no built artifact and no git repository.
 *
 * `porcelain` resolving to `null` is git declining to answer, and is a case the
 * screen renders rather than an error the route reports — see `writtenStatus`.
 * `present` is asked *after* git, and only settles the paths git said nothing
 * about.
 */
export interface EditorStatusDeps {
  staleness: () => IndexStaleness;
  porcelain: () => Promise<string | null>;
  /** Which of `WRITTEN_FILES` exist on disk. */
  present: () => ReadonlySet<string>;
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * Every refusal is a status and a sentence, and none of them is `next()`: this
 * path is the editor's alone, and falling through would hand a bad request the
 * static shell's HTML with a 200 on it.
 *
 * **Nothing about the environment reaches the response**, and this route is
 * stricter about that than its four neighbours. They relay a cause whole — "the
 * reader is the maintainer, and the paths are their own" — and that argument
 * still holds, but the causes *here* are uniquely bad carriers: git's failures
 * quote absolute paths and PATH lookups, and `indexStaleness` deals in absolute
 * paths by design (`indexStatus` is what strips the repo root off the one it
 * reports). So the 500 below names no path, no command and no cause, and the
 * remedy it gives is the one that works for every failure it can have: the dev
 * server's own console, where the maintainer can read the whole of it.
 */
export function editorStatusHandler(deps: EditorStatusDeps) {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: "Read the status with GET. It changes nothing." });
      return;
    }

    void (async () => {
      // This route has no body to use — a `GET` carries none — so the read is
      // only ever here to enforce the cap; the string it resolves to is not
      // read. See `web/editorTransport.ts` for why the read happens anyway.
      if ((await readCappedBody(req, res, MAX_STATUS_BODY_BYTES)) === null) return;

      let index: EditorStatus["index"];
      try {
        index = indexStatus(deps.staleness(), repoRoot);
      } catch {
        return sendJson(res, 500, {
          error:
            "The status could not be read. The dev server's console has the reason; " +
            "the day on screen is unaffected.",
        });
      }

      const porcelain = await deps.porcelain();
      const status: EditorStatus = {
        index,
        written: writtenStatus(porcelain === null ? null : porcelainCodes(porcelain), deps.present()),
      };
      sendJson(res, 200, status);
    })();
  };
}

export function editorStatusPlugin(): Plugin {
  return {
    name: "rhyme-bee-editor-status",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        EDITOR_STATUS_PATH,
        editorStatusHandler({
          staleness: () => indexStaleness(repoRoot),
          porcelain: () => uncommittedPorcelain(repoRoot, WRITTEN_FILES),
          present: () =>
            new Set(WRITTEN_FILES.filter((path) => existsSync(resolve(repoRoot, path)))),
        }),
      );
    },
  };
}
