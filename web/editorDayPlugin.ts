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

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { localCalendarDate, parseSchedule, type Schedule } from "../src/schedule.ts";
import { readScheduledDay } from "../scripts/editorDay.ts";
import { builtIndex } from "./builtIndex.ts";
import { EDITOR_DAY_PATH } from "./src/endpoints.ts";
import { MAX_REQUEST_BODY_BYTES, editorDayRequest } from "./editorDayRequest.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * Refuse a request carrying more than the cap, counting bytes as they arrive
 * rather than buffering the lot and measuring afterwards. `Content-Length` is an
 * early hint and never a fact — it is the sender's claim about the sender's own
 * body — so an oversize body that declared itself small is caught by the count
 * instead. This mirrors `worker/http.ts`'s `readCappedBody`, minus the parsing
 * a read has no body to do.
 *
 * Resolves `true` when the request was within the cap and can be answered. When
 * it resolves `false` the refusal has already been sent, so the caller returns.
 */
function withinCap(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    sendJson(res, 413, { error: "That request is too large." });
    return Promise.resolve(false);
  }

  return new Promise((settle) => {
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
        req.destroy();
        sendJson(res, 413, { error: "That request is too large." });
        settle(false);
      }
    });
    req.on("end", () => settle(size <= MAX_REQUEST_BODY_BYTES));
    // A connection that broke mid-body is not a request to answer, and the
    // response went with it — settle so nothing is left pending.
    req.on("error", () => settle(false));
  });
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * Every refusal is a status and a sentence, and none of them is `next()`: this
 * path is the editor's alone, and falling through would hand a bad request the
 * static shell's HTML with a 200 on it — a failure that reads as a success is
 * the one shape of failure worth ruling out here. The three cases of the readout
 * are *not* refusals: a date outside the run and a Seed the index cannot pin are
 * both things the editor needs rendered, so both are 200s carrying the case.
 */
export function editorDayHandler(deps: EditorDayDeps) {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: "Read a day with GET." });
      return;
    }

    void (async () => {
      if (!(await withinCap(req, res))) return;

      const asked = editorDayRequest(req.url ?? "/", deps.today());
      if (!asked.ok) return sendJson(res, 400, { error: asked.error });

      try {
        sendJson(res, 200, readScheduledDay(deps.openIndex, deps.schedule(), asked.date));
      } catch (error) {
        // What throws past `readScheduledDay` is a missing or unreadable
        // artifact, never anything about the day, and both of those errors
        // already name their file and their remedy. So the cause is relayed
        // whole and nothing is added to it: a second sentence guessing at the
        // remedy reads as two different diagnoses of one problem. Relaying is
        // safe here in a way it would not be on a deployed route — the reader
        // is the maintainer, and the paths are their own.
        sendJson(res, 500, {
          error: `Could not read ${asked.date}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    })();
  };
}

/**
 * The reviewed schedule artifact, read per request rather than held. It is a
 * small hand-edited file, and an editor who has just corrected a day should see
 * the correction on reload rather than after restarting the dev server.
 *
 * Read here rather than through `scripts/editorShell.ts`'s `loadSchedule`,
 * which answers an unreadable artifact with `process.exit(1)`. That is the right
 * answer for a command and the wrong one for a dev server: it would take the
 * whole server down, and the player's shell with it, over a file the player's
 * shell had not asked for.
 */
function readSchedule(): Schedule {
  const path = resolve(repoRoot, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) throw new Error(`${path} is not a readable schedule artifact.`);
  return parsed;
}

export function editorDayPlugin(): Plugin {
  return {
    name: "rhyme-bee-editor-day",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        EDITOR_DAY_PATH,
        editorDayHandler({
          schedule: readSchedule,
          openIndex: builtIndex,
          today: () => localCalendarDate(),
        }),
      );
    },
  };
}
