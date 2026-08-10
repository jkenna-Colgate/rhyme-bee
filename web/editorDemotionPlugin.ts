/**
 * The dev-only endpoint the Editor's Pass **demotes** a word through: the second
 * correction the pass produces, beside the Tier picker's (ADR-0016). A Vite
 * plugin that, during `npm run dev` only (`apply: "serve"`, so `configureServer`
 * never runs in a production build), answers two verbs on
 * `/api/editor/demotion`:
 *
 * - `GET` returns every entry standing in `data/demotions.txt`.
 * - `POST` appends one entry to that file **and returns the file's own refreshed
 *   state**.
 *
 * ## Why this is a second route rather than a fifth verdict
 *
 * A demotion removes **wordhood**, which no Tier verdict can express: setting a
 * name's prevalence to the Bonus sentinel leaves its wordhood intact and hands
 * the player an accepted, celebrated Bonus Word — a name, congratulated. The two
 * corrections go to two files that the build reads at two different stages, so
 * they are two writes, and folding them into one route would have meant a route
 * whose body decided which file it was writing to.
 *
 * ## Appends only, and no un-demote
 *
 * There is no verb here that removes an entry, and there is none in the browser
 * either. Reversing a demotion is a hand edit of `data/demotions.txt`, on the
 * ticket's own reasoning: a demotion is not a judgement call between two Tiers
 * that an editor might revisit, it is a statement that a string is not a word of
 * the game, and the cost of getting one wrong is a single word missing from a
 * single Puzzle. The cost of an un-demote button is a click away from serving a
 * name as an Answer again. An `undo` for a file the maintainer can open in an
 * editor is not worth that trade, and the file is small enough that the hand
 * edit is a matter of deleting one line.
 *
 * That is also why a word the file already names is **refused** rather than
 * appended a second time — though not because order would decide the
 * player's rejection. It would not: `applyDemotions` (`src/demotions.ts`)
 * applies each line as a set operation — `words.delete(word)`, and
 * `names.add(word)` when the reason is `proper-noun` — and both are
 * idempotent, so a `proper-noun` line anywhere in the file wins regardless of
 * where a second line for the same word falls. A second line is not a second
 * vote; it is inert. `hadWordhood` records only whether *that* line's delete
 * found something, and the one reader of it is `scripts/build-index.ts`'s
 * stale-entry report — a build-time diagnostic, not the adjudication the
 * player's rejection is drawn from.
 *
 * The 409 exists for what a second, inert line would do to the file itself.
 * `src/__tests__/demotions.test.ts` holds "lists each word once" as an
 * invariant of the committed file, and a second row breaks it while changing
 * nothing: a `proper-noun` line followed by a `not-a-known-word` line for the
 * same word does not retract the first, so the second row reads to the next
 * maintainer as a correction that never actually happened. Refusing the write
 * keeps the file at the one row per word the suite already assumes, rather
 * than let it silently grow rows with no effect.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * It **writes** to `data/`. A route that survived into production would be a
 * path from the public internet into the repository. Three things make that
 * impossible rather than unlikely: `apply: "serve"` here, `vite.config.ts`
 * naming the build's inputs so `editor.html` is never in a bundle, and no Worker
 * route answering this path. It does not weaken ADR-0013 either: there is no
 * player, no Session and no Submission being adjudicated — a maintainer is
 * editing their own repository over localhost.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseDemotions, type Demotion } from "../src/demotions.ts";
import { EDITOR_DEMOTION_PATH } from "./src/endpoints.ts";
import type { DemotionState, DemotionWriteResult } from "./src/editor/demote.ts";
import { appendDemotion, readDemotionText } from "./demotionFile.ts";
import { MAX_DEMOTION_BODY_BYTES, demotionWriteRequest } from "./editorDemotionRequest.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { relayCause, sendJson } from "./editorTransport.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server and — the one that matters — **no `data/`
 * directory**. Every unit test of this route appends to an array.
 *
 * There is no schedule, no index and no clock among them. A demotion takes a
 * word's wordhood, which is a property of the word and of no day: nothing here
 * needs to know which Puzzle the editor was looking at when they clicked, and a
 * date parameter would be a fact the route could get wrong for no purpose.
 */
export interface EditorDemotionDeps {
  /** `data/demotions.txt` as text; empty when there is no file. */
  demotions: () => string;
  append: (demotion: Demotion) => void;
}

/** The file's entries, read fresh: the screen's model of what is demoted is the file's. */
function stateOf(deps: EditorDemotionDeps): DemotionState {
  return { standing: parseDemotions(deps.demotions()) };
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped. It dispatches on the verb itself, because which of the two verbs was
 * used is what the work *is* here rather than something the skeleton could
 * decide for it: the skeleton's part is only that a third verb never arrives.
 *
 * The order of the checks on a write is the order in which each one can rule the
 * write out: the verb, then the size — both `web/editorRoute.ts`'s — then the
 * demotion, then whether the file already holds the word. Nothing touches the
 * file until all four have passed, which is what "every refusal writes nothing"
 * means and what the suite asserts of each of them in turn.
 */
export function editorDemotionHandler(deps: EditorDemotionDeps) {
  return (req: IncomingMessage, res: ServerResponse, body: string): void => {
    try {
      if ((req.method ?? "GET") === "GET") return sendJson(res, 200, stateOf(deps));

      const asked = demotionWriteRequest(body);
      if (!asked.ok) return sendJson(res, 400, { error: asked.error });

      const standing = stateOf(deps).standing.find((entry) => entry.word === asked.word);
      if (standing !== undefined) {
        // Not an error the editor made — the word may have been demoted on an
        // earlier visit — so it says what is already true rather than scolding.
        // 409 because the request is fine and the file's state is what refuses
        // it, which is also what a retry will keep doing.
        return sendJson(res, 409, {
          error:
            `${asked.word} is already demoted, as ${standing.reason}. ` +
            "Reversing a demotion is a hand edit of data/demotions.txt.",
        });
      }

      const appended: Demotion = { word: asked.word, reason: asked.reason };
      deps.append(appended);
      const result: DemotionWriteResult = { state: stateOf(deps), appended };
      sendJson(res, 200, result);
    } catch (error) {
      // What throws past here is an unreadable demotion list or a file that
      // would not take the append, and both already name their file.
      // `relayCause` argues why the cause travels whole and nothing is added.
      relayCause(res, "Could not record that demotion", error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorDemotionSpec(deps: EditorDemotionDeps): EditorRouteSpec {
  return {
    path: EDITOR_DEMOTION_PATH,
    verbs: ["GET", "POST"],
    refusal: "Read the demotion list with GET, record a demotion with POST.",
    cap: MAX_DEMOTION_BODY_BYTES,
    handle: editorDemotionHandler(deps),
  };
}

const demotionPath = resolve(repoRoot, "data/demotions.txt");

export function editorDemotionPlugin(): Plugin {
  return editorRoute(
    editorDemotionSpec({
      demotions: () => readDemotionText(demotionPath),
      append: (demotion) => appendDemotion(demotionPath, demotion),
    }),
  );
}
