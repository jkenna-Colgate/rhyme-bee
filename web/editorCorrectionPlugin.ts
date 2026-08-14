/**
 * The dev-only endpoint the Editor's Pass **corrects a reading** through
 * (#180). A Vite plugin that `web/editorRoute.ts` builds from the spec at the
 * foot of this file — which is where the `apply: "serve"` that keeps
 * `configureServer` out of a production build is declared — answering `POST` on
 * `/api/editor/correction`.
 *
 * *What* a correction is lives in `scripts/editorCorrection.ts` and arrives here
 * as a value. This module carries it over HTTP and decides nothing: it neither
 * chooses between replace and join nor judges whether a proposal reaches its
 * target. If either ever appears in this file, the shape has gone wrong.
 *
 * ## Two asks, and nothing written between them
 *
 * A body with no reading on it asks an agent to **propose** one and writes
 * nothing at all. A body that names a reading and a mode **approves** it, and
 * that request writes to `data/supplement.dict`, rebuilds the Rhyme Index and
 * rechecks the days the word's Rhyme Keys reach. `correctionRequest`
 * (`web/editorCorrectionRequest.ts`) is what tells the two apart, so "nothing is
 * written before approval" is a property of a parsed body rather than of this
 * handler remembering to check.
 *
 * The proposal is **not** held here between the two requests. A server-side copy
 * of "the reading proposed for `tear`" is a second copy of a fact, and the copy
 * that goes wrong is the one that writes an approval the editor never saw — so
 * an approval names the phonemes it approves and they are validated as though
 * nothing had proposed them.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * It **writes** to `data/`, **spawns a process** and **rewrites `dist-data/`** —
 * the same three as the add route, which makes it the joint heaviest of the
 * editor routes to leave reachable. Three things make a production copy
 * impossible rather than unlikely: the `apply: "serve"` that `web/editorRoute.ts`
 * declares for every route built on it, this one included; `vite.config.ts`
 * naming the build's inputs so `editor.html` is never in a bundle; and no Worker
 * route answering this path. It does not weaken ADR-0013 either: there is no
 * player, no Session and no Submission being adjudicated — a maintainer is
 * editing their own repository over localhost.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { Schedule } from "../src/schedule.ts";
import type { EvidenceContext } from "../src/supplementEvidence.ts";
import { pinnedEvidenceContext, type AgentAuthor } from "../scripts/editorAdd.ts";
import { applyCorrection, proposeCorrection } from "../scripts/editorCorrection.ts";
import { builtIndex } from "./builtIndex.ts";
import { MAX_CORRECTION_BODY_BYTES, correctionRequest } from "./editorCorrectionRequest.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { readSchedule } from "./editorSchedule.ts";
import { relayCause, sendJson } from "./editorTransport.ts";
import { rebuildIndex } from "./indexRebuild.ts";
import { repoRoot } from "./repoRoot.ts";
import type { RebuildResult } from "./src/editor/add.ts";
import { EDITOR_CORRECTION_PATH } from "./src/endpoints.ts";

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no pinned sources, no artifact and no subprocess.
 *
 * `context` is called per request rather than cached, like the queue route's and
 * unlike `builtIndex`: a correction approved five minutes ago is in `data/`, and
 * a context held for the dev server's lifetime would propose against the
 * readings as they stood when the server started.
 *
 * `author` is the agent seam, defaulted to the live `claude -p` adapter by
 * `proposeCorrection` itself. It is here so a test can stand in for it, which is
 * the same reason `AddDeps.author` exists.
 */
export interface EditorCorrectionDeps {
  context: () => EvidenceContext;
  schedule: () => Schedule;
  openIndex: () => RhymeIndex;
  rebuild: () => Promise<RebuildResult>;
  author?: AgentAuthor;
  /** Where an approved reading lands. `data/supplement.dict` when unsaid. */
  supplementPath?: string;
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped.
 *
 * The order of the checks is the order in which each can rule the request out:
 * the verb, then the size — both `web/editorRoute.ts`'s — then the ask. Nothing
 * is written until all three have passed, and the proposal branch writes nothing
 * whatever they say.
 *
 * Two `try` scopes rather than one, because the two asks fail differently and an
 * editor reading the sentence should be able to tell which happened. A proposal
 * that threw has changed nothing and the remedy is to ask again; an approval
 * that threw may have written the reading and failed the rebuild, and the remedy
 * is `npm run build:index`. One sentence over both would have to be vague enough
 * to cover a write that did happen.
 */
export function editorCorrectionHandler(deps: EditorCorrectionDeps) {
  return async (_req: IncomingMessage, res: ServerResponse, body: string): Promise<void> => {
    const asked = correctionRequest(body);
    if (!asked.ok) return sendJson(res, 400, { error: asked.error });

    if (asked.ask === "propose") {
      try {
        const proposal = await proposeCorrection(
          asked.word,
          asked.rhymeKey,
          deps.context(),
          deps.author,
        );
        return sendJson(res, 200, proposal);
      } catch (error) {
        // What throws past `proposeCorrection` is a pinned source that would not
        // read, which names its own file. Nothing was written: this branch has
        // no write in it at all.
        return relayCause(res, "Could not ask for a correction", error);
      }
    }

    try {
      const result = await applyCorrection(
        {
          word: asked.word,
          target: asked.rhymeKey,
          phonemes: asked.phonemes,
          mode: asked.mode,
        },
        {
          context: deps.context,
          schedule: deps.schedule,
          openIndex: deps.openIndex,
          rebuild: deps.rebuild,
          supplementPath: deps.supplementPath,
        },
      );
      sendJson(res, 200, result);
    } catch (error) {
      // A supplement that would not take the append, an unreadable schedule or a
      // pinned source that would not read — each names its own file, which is
      // `relayCause`'s argument for the cause travelling whole. A rebuild that
      // merely *failed* does not arrive here: it comes back on `rebuilt` beside
      // the reading that was written, because an editor told only "the build
      // failed" would approve the same correction twice.
      relayCause(res, "Could not approve that correction", error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorCorrectionSpec(deps: EditorCorrectionDeps): EditorRouteSpec {
  return {
    path: EDITOR_CORRECTION_PATH,
    verbs: ["POST"],
    refusal:
      "Propose or approve a correction with POST. Asking for one writes nothing; only an " +
      "approval naming a reading does.",
    cap: MAX_CORRECTION_BODY_BYTES,
    handle: editorCorrectionHandler(deps),
  };
}

export function editorCorrectionPlugin(): Plugin {
  return editorRoute(
    editorCorrectionSpec({
      context: pinnedEvidenceContext,
      schedule: readSchedule,
      openIndex: builtIndex,
      rebuild: () => rebuildIndex(repoRoot),
    }),
  );
}
