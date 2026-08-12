/**
 * The dev-only endpoint the Editor's Pass reads the **Candidate Queue** through
 * (#177). A Vite plugin that `web/editorRoute.ts` builds from the spec below,
 * and that is dev-only because that module gives every route it builds the
 * `apply: "serve"` which keeps `configureServer` from running in a production
 * build — answering `GET /api/editor/candidates` with the whole readout, every
 * Candidate's state already resolved.
 *
 * *What* the queue is lives in `scripts/editorCandidates.ts` and arrives here as
 * a value. This module only carries it over HTTP: it parses no state, derives no
 * state and decides nothing, which is the point of the split (#176). If a
 * resolved check, a Decline lookup or an add-versus-correct determination ever
 * appears in this file, the shape has gone wrong.
 *
 * The browser on the other end computes nothing either. Resolution needs the
 * pinned sources — fifteen megabytes' worth of readings, Normalisation applied —
 * so it is computed in Node, which is ADR-0016's position and the same one the
 * day route takes.
 *
 * ## The one route in the pass that reads the queue back
 *
 * The Editor's Pass already *writes* to this queue: when an add turns out to
 * read on a Rhyme Key other than the day's, the disagreement is recorded as a
 * Candidate on the same file, through `APPEAL_PATH` (#163). This is the read
 * back — the pipe already ran one direction.
 *
 * **This route writes nothing**, and neither does the slice it belongs to.
 * Resolution is derived on every read, so a Candidate fixed by a change made
 * anywhere else in the build clears itself with no file recording that it did.
 * The Declines file is the only thing this feature ever writes, and the gesture
 * that writes it is slice 2's.
 *
 * ## Why the pull is still a CLI step
 *
 * The queue is filled from R2 by `npm run pull:appeals`, run before the dev
 * server. A button here would put credential handling, network latency and a
 * new failure mode into a tool whose every other act is local (#176). What the
 * screen gets instead is `newest` — the queue's own newest timestamp — so a list
 * that is stale because nobody has pulled *looks* stale rather than empty.
 */

import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseDeclines, type Decline } from "../src/declines.ts";
import type { Schedule } from "../src/schedule.ts";
import { parseCandidates, type SupplementCandidate } from "../src/supplementCandidate.ts";
import type { EvidenceContext } from "../src/supplementEvidence.ts";
import { readCandidateQueue } from "../scripts/editorCandidates.ts";
import { pinnedEvidenceContext } from "../scripts/editorAdd.ts";
import { DECLINES_PATH, readDeclineText } from "./declinesFile.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { readSchedule } from "./editorSchedule.ts";
import { relayCause, sendJson } from "./editorTransport.ts";
import { readOptional } from "./readOptional.ts";
import { repoRoot } from "./repoRoot.ts";
import { EDITOR_CANDIDATES_PATH } from "./src/endpoints.ts";

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A queue read names nothing and carries no body, so this is the answer to a
 * body that arrives anyway rather than a size the route expects to use — the
 * situation `editorStatusPlugin.ts` describes, and 512 bytes is its number for
 * the same reason. Declared here rather than imported, because a shared cap
 * would mean a change to either route being reasoned about as a change to both
 * (`web/editorTransport.ts`).
 */
const MAX_QUEUE_BODY_BYTES = 512;

/**
 * The append-only capture queue. The standing rulings over it are read through
 * `web/declinesFile.ts`, which owns their path as well as their IO: two plugins
 * read that file — this one and the route that appends to it — and two spellings
 * of one location is a ruling written where nobody looks.
 */
const QUEUE_PATH = resolve(repoRoot, "data/supplement-candidates.jsonl");

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no queue on disk and no pinned sources.
 *
 * Four reads and no writes. `context` is the heaviest by far — it parses
 * `data/cmudict.dict` and applies the committed supplement and Normalisation —
 * and it is called per request rather than cached, like `readSchedule` beside
 * it and unlike `builtIndex`: the whole point of this screen is that a fix
 * landing in `data/` retires a Candidate, and a context held for the dev
 * server's lifetime would keep showing the queue as it stood when the server
 * started.
 */
export interface EditorCandidatesDeps {
  queue: () => SupplementCandidate[];
  schedule: () => Schedule;
  declines: () => Decline[];
  context: () => EvidenceContext;
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped — and which this route has no use for, a `GET` carrying none.
 *
 * There is nothing to parse: no date, no words, no verdict. So the one `try`
 * covers the whole read, and what can throw past it is a missing pinned source
 * or an unreadable schedule, both of which already name their file and their
 * remedy. `relayCause` argues why the cause travels whole and nothing is added
 * to it.
 *
 * A queue file that does not exist yet is **not** a failure: it is an empty
 * queue, which the readout renders as such. Nobody has Appealed, or nobody has
 * pulled — and the screen says which, because `newest` is null either way and
 * `data/` is where the maintainer looks next.
 */
export function editorCandidatesHandler(deps: EditorCandidatesDeps) {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    try {
      sendJson(
        res,
        200,
        readCandidateQueue(deps.queue(), deps.schedule(), deps.declines(), deps.context()),
      );
    } catch (error) {
      relayCause(res, "Could not read the Candidate Queue", error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorCandidatesSpec(deps: EditorCandidatesDeps): EditorRouteSpec {
  return {
    path: EDITOR_CANDIDATES_PATH,
    verbs: ["GET"],
    refusal: "Read the Candidate Queue with GET. Nothing on it is written from here.",
    cap: MAX_QUEUE_BODY_BYTES,
    handle: editorCandidatesHandler(deps),
  };
}

export function editorCandidatesPlugin(): Plugin {
  return editorRoute(
    editorCandidatesSpec({
      queue: () => parseCandidates(readOptional(QUEUE_PATH)),
      schedule: readSchedule,
      declines: () => parseDeclines(readDeclineText(DECLINES_PATH)),
      context: pinnedEvidenceContext,
    }),
  );
}
