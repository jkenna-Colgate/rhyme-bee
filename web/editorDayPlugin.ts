/**
 * The dev-only endpoint the Editor's Pass reads a day through. A Vite plugin
 * that, during `npm run dev` only (`apply: "serve"`, so `configureServer` never
 * runs in a production build), answers `GET /api/editor/day`: it resolves the
 * date, builds the day against the built Rhyme Index and returns the readout as
 * JSON. It writes nothing, anywhere — repinning a day the index cannot pin is
 * out of scope, and the diagnosis is all this offers.
 *
 * *What* a day is lives in `scripts/editorDay.ts` and arrives here as a value;
 * this module only carries it over HTTP, and is the transport under the second
 * of that value's two renderers (ADR-0016). The terminal's renderer,
 * `scripts/editorRead.ts`, calls the same function over the same artifacts, so
 * the two surfaces cannot disagree about a day.
 *
 * The browser on the other end computes nothing: the index is fifteen megabytes
 * and a day's readout is a few KB, and a figure computed twice is a figure that
 * can differ. That is ADR-0016's position, and it does not weaken ADR-0013 —
 * there is no player here, no Session and no Submission being adjudicated, only
 * a maintainer reading their own repository over localhost.
 *
 * Dev-only matters more here than for `supplementPlugin`: this endpoint reads
 * `data/` and the later slices of the pass will write it, so a route that
 * survived into production would be a path from the public internet into the
 * repository. This plugin is one half of that guarantee; `vite.config.ts` naming
 * the build's input is the other, and keeps the editor's HTML entry out of a
 * build.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { localCalendarDate, type Schedule } from "../src/schedule.ts";
import { readScheduledDay } from "../scripts/editorDay.ts";
import { builtIndex } from "./builtIndex.ts";
import { EDITOR_DAY_PATH } from "./src/endpoints.ts";
import { MAX_REQUEST_BODY_BYTES, editorDayRequest } from "./editorDayRequest.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { readSchedule } from "./editorSchedule.ts";
import { relayCause, sendJson } from "./editorTransport.ts";

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no artifact and no clock. `openIndex` is passed
 * through to `readScheduledDay` **unopened**, which is the whole reason it is a
 * function rather than an index: a date outside the run is answered without
 * reading fifteen megabytes off disk, and a mistyped date should not cost that.
 */
export interface EditorDayDeps {
  schedule: () => Schedule;
  openIndex: () => RhymeIndex;
  /** The editor's own calendar date, from which "tomorrow" is taken. */
  today: () => string;
}

/**
 * The route's own work, over a body the skeleton has already read and capped —
 * and which this route has no use for, a `GET` carrying none.
 *
 * The refusals the shared skeleton makes (the verb, the size) and the reason
 * none of them is `next()` are `web/editorRoute.ts`'s. What is this route's own
 * is the date: an unparseable one is a 400 and reads no day. The three cases of
 * the readout are *not* refusals — a date outside the run and a Seed the index
 * cannot pin are both things the editor needs rendered, so both are 200s
 * carrying the case.
 */
export function editorDayHandler(deps: EditorDayDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const asked = editorDayRequest(req.url ?? "/", deps.today());
    if (!asked.ok) return sendJson(res, 400, { error: asked.error });

    try {
      sendJson(res, 200, readScheduledDay(deps.openIndex, deps.schedule(), asked.date));
    } catch (error) {
      // What throws past `readScheduledDay` is a missing or unreadable
      // artifact, never anything about the day. `relayCause` argues why the
      // cause travels whole and nothing is added to it.
      relayCause(res, `Could not read ${asked.date}`, error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorDaySpec(deps: EditorDayDeps): EditorRouteSpec {
  return {
    path: EDITOR_DAY_PATH,
    verbs: ["GET"],
    refusal: "Read a day with GET.",
    cap: MAX_REQUEST_BODY_BYTES,
    handle: editorDayHandler(deps),
  };
}

export function editorDayPlugin(): Plugin {
  return editorRoute(
    editorDaySpec({
      schedule: readSchedule,
      openIndex: builtIndex,
      today: () => localCalendarDate(),
    }),
  );
}
