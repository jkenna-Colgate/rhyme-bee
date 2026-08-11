/**
 * The dev-only endpoint the Editor's Pass reads its own state through (#162). A
 * Vite plugin that `web/editorRoute.ts` builds from the spec below, and that is
 * dev-only because that module gives every route it builds the `apply: "serve"`
 * which keeps `configureServer` from running in a production build. It answers
 * `GET` on
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
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { indexStaleness, type IndexStaleness } from "../scripts/indexArtifact.ts";
import { indexStatus, porcelainCodes, writtenStatus } from "./editorStatusReport.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { sendJson } from "./editorTransport.ts";
import { EDITOR_STATUS_PATH } from "./src/endpoints.ts";
import { WRITTEN_FILES, type EditorStatus } from "./src/editor/status.ts";
import { repoRoot } from "./repoRoot.ts";
import { uncommittedPorcelain } from "./workingTree.ts";

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
 * The route's own work. There is no request to parse — this is the one editor
 * route with no date, no words and no verdict — so the body the shared skeleton
 * read is only ever the cap being enforced, and nothing here looks at it.
 *
 * The `try` covers the staleness read **only**. The git read below it and the
 * compose after are deliberately outside: `porcelain` resolving to `null` is
 * git declining to answer and is a case the screen renders rather than an error
 * this route reports, and a wider scope would turn it into one.
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
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let index: EditorStatus["index"];
    try {
      index = indexStatus(deps.staleness(), repoRoot);
    } catch (error) {
      // The remedy below promises the console has the reason, so the reason is
      // put there. Withholding a cause from the response is not the same act as
      // discarding it, and the difference is whether the maintainer the remedy
      // addresses can act on it.
      console.error("[rhyme-bee] the editor status could not read the index:", error);
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
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorStatusSpec(deps: EditorStatusDeps): EditorRouteSpec {
  return {
    path: EDITOR_STATUS_PATH,
    verbs: ["GET"],
    refusal: "Read the status with GET. It changes nothing.",
    cap: MAX_STATUS_BODY_BYTES,
    handle: editorStatusHandler(deps),
  };
}

export function editorStatusPlugin(): Plugin {
  return editorRoute(
    editorStatusSpec({
      staleness: () => indexStaleness(repoRoot),
      porcelain: () => uncommittedPorcelain(repoRoot, WRITTEN_FILES),
      present: () => new Set(WRITTEN_FILES.filter((path) => existsSync(resolve(repoRoot, path)))),
    }),
  );
}
