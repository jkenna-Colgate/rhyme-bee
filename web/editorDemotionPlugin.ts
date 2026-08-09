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
 * appended a second time. Unlike `data/tier-overrides.csv`, the demotion list
 * has no last-wins resolution — `applyDemotions` runs every line — so two lines
 * naming one word with two reasons would apply both, and which rejection the
 * player received would fall out of the order the lines happened to be in. The
 * committed file lists each word once, and this keeps it that way.
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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * Read a request body, refusing anything over the cap as the bytes arrive rather
 * than buffering the lot and measuring afterwards. `Content-Length` is an early
 * hint and never a fact — it is the sender's claim about the sender's own body —
 * so an oversize body that declared itself small is caught by the count instead.
 *
 * Resolves the body, or `null` when the request was refused; a `null` means the
 * refusal has already been sent and the caller returns. The Tier route carries
 * the same helper against its own cap: sharing one would mean a change to either
 * route's cap being reasoned about as a change to both, which is the coupling
 * `editorTierRequest.ts` declined for the constants themselves.
 */
function readCappedBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_DEMOTION_BODY_BYTES) {
    sendJson(res, 413, { error: "That request is too large." });
    return Promise.resolve(null);
  }

  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_DEMOTION_BODY_BYTES) {
        req.destroy();
        sendJson(res, 413, { error: "That request is too large." });
        settle(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      settle(size > MAX_DEMOTION_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")),
    );
    // A connection that broke mid-body is not a request to answer, and the
    // response went with it — settle so nothing is left pending.
    req.on("error", () => settle(null));
  });
}

/** The file's entries, read fresh: the screen's model of what is demoted is the file's. */
function stateOf(deps: EditorDemotionDeps): DemotionState {
  return { standing: parseDemotions(deps.demotions()) };
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * Every refusal is a status and a sentence, and none of them is `next()`: this
 * path is the editor's alone, and falling through would hand a bad request the
 * static shell's HTML with a 200 on it — the one shape of failure worth ruling
 * out on a route whose success case writes to `data/`.
 *
 * The order of the checks on a write is the order in which each one can rule the
 * write out: the verb, then the size, then the demotion, then whether the file
 * already holds the word. Nothing touches the file until all four have passed,
 * which is what "every refusal writes nothing" means and what the suite asserts
 * of each of them in turn.
 */
export function editorDemotionHandler(deps: EditorDemotionDeps) {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      sendJson(res, 405, {
        error: "Read the demotion list with GET, record a demotion with POST.",
      });
      return;
    }

    void (async () => {
      const body = await readCappedBody(req, res);
      if (body === null) return;

      try {
        if (method === "GET") return sendJson(res, 200, stateOf(deps));

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
        // would not take the append. Both already name their file, so the cause
        // is relayed whole and nothing is added to it — a second sentence
        // guessing at the remedy reads as two diagnoses of one problem. Relaying
        // is safe in a way it would not be on a deployed route: the reader is
        // the maintainer, and the paths are their own.
        sendJson(res, 500, {
          error: `Could not record that demotion: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    })();
  };
}

const demotionPath = resolve(repoRoot, "data/demotions.txt");

export function editorDemotionPlugin(): Plugin {
  return {
    name: "rhyme-bee-editor-demotion",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        EDITOR_DEMOTION_PATH,
        editorDemotionHandler({
          demotions: () => readDemotionText(demotionPath),
          append: (demotion) => appendDemotion(demotionPath, demotion),
        }),
      );
    },
  };
}
