/**
 * The dev-only endpoint the Editor's Pass **declines a Candidate** through: the
 * one thing judging the Candidate Queue writes that has no other home (#176,
 * ADR-0017). A Vite plugin that `web/editorRoute.ts` builds from the spec below
 * — which is where the `apply: "serve"` that keeps `configureServer` out of a
 * production build is declared — answering one verb on `/api/editor/decline`:
 * `POST`, which appends one ruling to `data/declines.txt` and answers with the
 * ruling it wrote.
 *
 * ## Why there is no `GET`
 *
 * Because nothing would read it. Which Candidates stand declined is derived
 * server-side on every read of the queue (`scripts/editorCandidates.ts`), which
 * is the design #176 insists on — deriving it in one place is the point — so a
 * verb serving the same fact a second way would be a second answer for the
 * screen to choose between. The file *is* read here, but only to refuse a pair
 * it already holds; that read is this route's own and is not a payload.
 *
 * ## Why this is a second route rather than a third demotion reason
 *
 * A demotion changes adjudication: it withdraws wordhood, and the player's next
 * Submission of that word is refused differently because of it. A Decline
 * changes nothing at all — no verdict, no Puzzle, no figure — and exists only so
 * a queue an editor has worked stops re-presenting itself. Two files with
 * opposite reach must be free to vary apart (`src/declines.ts`), and one route
 * writing both would be a route whose body decided which file it was writing to
 * — the shape `editorDemotionPlugin.ts` rejected for the same reason against the
 * Tier route.
 *
 * The other two Declines an editor can make are **not here**. A Proper Noun and
 * junk with wordhood are demotions, and the gesture reaches
 * `EDITOR_DEMOTION_PATH` with the word prefilled rather than writing a second
 * copy of that fact (`web/src/editor/decline.ts`).
 *
 * ## Appends only, and no un-decline
 *
 * There is no verb here that removes a ruling, and there is none in the browser
 * either — the position `#160` took for the demotion list, arrived at from the
 * opposite direction. There it is because an un-demote button is a click away
 * from serving a name as an Answer again. Here it is because undoing a Decline
 * costs one Candidate reappearing on a screen only the editor sees, which is the
 * cheapest failure in the tool and does not justify a verb. Either way the file
 * is committed data a maintainer can open, and the reversal is deleting a line.
 *
 * A pair the file already holds is **refused** rather than appended twice. A
 * second identical line is inert — `declinedPairs` is a `Set` — so this is about
 * the file rather than the lookup: rows that change nothing accumulate, and the
 * next maintainer reads two rulings where one was made. The refusal is only
 * reachable from a screen that has gone stale, since a declined Candidate comes
 * back from the queue readout already settled.
 *
 * ## Why the path is injected and the file is not
 *
 * `EditorDeclineDeps` carries a **path**, following `AddDeps.deferredPath`, and
 * not a pair of read/append functions the way `EditorDemotionDeps` does. There
 * is one adapter — `web/declinesFile.ts` — and the tests drive it over a temp
 * directory (`web/__tests__/declinesFile.test.ts` is the technique, and
 * `tierOverrideFile.test.ts` is where it started). Substituting the IO instead
 * would leave the route's every test passing against an array while the one
 * thing that can lose a ruling — a fused line on a file whose last newline was
 * trimmed — was exercised by nothing the route runs.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * It **writes** to `data/`. A route that survived into production would be a
 * path from the public internet into the repository. Three things make that
 * impossible rather than unlikely: `apply: "serve"`, which `web/editorRoute.ts`
 * declares once for every editor route; `vite.config.ts` naming the build's
 * inputs so `editor.html` is never in a bundle; and no Worker route answering
 * this path. It does not weaken ADR-0013 either: there is no player, no Session
 * and no Submission being adjudicated — a maintainer is editing their own
 * repository over localhost.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { declineKey, declinedPairs, parseDeclines, type Decline } from "../src/declines.ts";
import { appendDecline, readDeclineText, DECLINES_PATH } from "./declinesFile.ts";
import { MAX_DECLINE_BODY_BYTES, declineWriteRequest } from "./editorDeclineRequest.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { relayCause, sendJson } from "./editorTransport.ts";
import type { DeclineWriteResult } from "./src/editor/decline.ts";
import { EDITOR_DECLINE_PATH } from "./src/endpoints.ts";

/**
 * What the handler needs from the world: one path, and nothing else.
 *
 * No schedule, no index and no clock. A Decline is a word aimed at a Rhyme Key,
 * both of which arrive in the request; nothing here needs to know which Puzzle
 * the editor was looking at when they clicked, and most Candidates have no
 * scheduled day for it to be.
 */
export interface EditorDeclineDeps {
  /** Where the rulings live. `data/declines.txt` when a caller says nothing. */
  declinesPath?: string;
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped.
 *
 * The order of the checks is the order in which each one can rule the write out:
 * the verb, then the size — both `web/editorRoute.ts`'s — then the ruling, then
 * whether the file already holds the pair. Nothing touches the file until all
 * four have passed, which is what "every refusal writes nothing" means and what
 * the suite asserts of each of them in turn.
 */
export function editorDeclineHandler(deps: EditorDeclineDeps) {
  const path = deps.declinesPath ?? DECLINES_PATH;

  return (_req: IncomingMessage, res: ServerResponse, body: string): void => {
    try {
      const asked = declineWriteRequest(body);
      if (!asked.ok) return sendJson(res, 400, { error: asked.error });

      // `declinedPairs` and not a `some` over the entries: the pair is the
      // lookup this file documents, and re-deriving it here would be a second
      // place the two halves of a key are joined.
      const wanted = declineKey(asked.word, asked.rhymeKey);
      if (declinedPairs(parseDeclines(readDeclineText(path))).has(wanted)) {
        // Not an error the editor made — the ruling may have been made on an
        // earlier visit, and the screen in front of them may predate it. 409
        // because the request is fine and the file's state is what refuses it,
        // which is also what a retry will keep doing.
        return sendJson(res, 409, {
          error:
            `${asked.word} is already declined against ${asked.rhymeKey}. ` +
            "Reversing a Decline is a hand edit of data/declines.txt.",
        });
      }

      const appended: Decline = { word: asked.word, rhymeKey: asked.rhymeKey };
      appendDecline(path, appended);
      const result: DeclineWriteResult = { appended };
      sendJson(res, 200, result);
    } catch (error) {
      // What throws past here is a file that would not take the append or a
      // directory that is not there, and both already name their path.
      // `relayCause` argues why the cause travels whole and nothing is added.
      relayCause(res, "Could not record that Decline", error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorDeclineSpec(deps: EditorDeclineDeps = {}): EditorRouteSpec {
  return {
    path: EDITOR_DECLINE_PATH,
    verbs: ["POST"],
    refusal:
      "Record a Decline with POST. What is already declined is on the Candidate Queue readout.",
    cap: MAX_DECLINE_BODY_BYTES,
    handle: editorDeclineHandler(deps),
  };
}

export function editorDeclinePlugin(): Plugin {
  return editorRoute(editorDeclineSpec());
}
