/**
 * The dev-only endpoint the Editor's Pass **submits its add queue** through: the
 * other half of the pass, in the same sitting that found the gap (ADR-0016). A
 * Vite plugin that, during `npm run dev` only (`apply: "serve"`, so
 * `configureServer` never runs in a production build), answers `POST` on
 * `/api/editor/add`.
 *
 * ## One request, three acts, in this order
 *
 * The words are given readings and written (`add`, `scripts/editorAdd.ts`); the
 * Rhyme Index is rebuilt; the day is re-read from the artifact that rebuild
 * produced. #161 calls that "the single button that makes a pass real", and the
 * order is not negotiable — a re-read before the rebuild returns the day as it
 * was, and a rebuild before the writes folds in nothing. Doing all three behind
 * one call is what removes the order from the editor's head; three routes would
 * put it back and add a half-done pass to lose it in.
 *
 * The rebuild runs **whatever the batch came to**, including a batch every word
 * of which already read correctly. That is deliberate. The obvious optimisation
 * — skip the rebuild when nothing was written — is wrong in the case that
 * matters: a Tier verdict or a demotion recorded earlier in the same sitting is
 * already on disk and not yet in the artifact, so an index skipped here is one
 * the day is then re-read from while still stale, and `DayReadoutView` would
 * quietly restore the band verdicts it had been withholding. Knowing whether
 * *those* files have moved is `indexStaleness`'s question and #162's ticket;
 * guessing at half of it here would be the worse of the two errors, and the
 * whole rebuild is 2.4 seconds.
 *
 * ## What this route does not write
 *
 * No Tier verdict and no demotion. Those are `data/tier-overrides.csv` and
 * `data/demotions.txt`, both already written by the click that made them
 * (#159, #160) — by the time Submit runs they are on disk, and re-recording
 * them here would append rows nobody asked for. The deps below are the whole of
 * what this handler can reach, and neither file is among them;
 * `web/__tests__/editorAddEndpoint.test.ts` holds the two paths to account
 * across a real call rather than leaving the claim to this sentence.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * It is the heaviest of the four editor routes to leave reachable: it **writes**
 * to `data/`, **spawns a process** and **rewrites `dist-data/`**. Three things
 * make a production copy impossible rather than unlikely: `apply: "serve"` here,
 * `vite.config.ts` naming the build's inputs so `editor.html` is never in a
 * bundle, and no Worker route answering this path. It does not weaken ADR-0013
 * either: there is no player, no Session and no Submission being adjudicated —
 * a maintainer is editing their own repository over localhost.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { parseSchedule, type Schedule } from "../src/schedule.ts";
import { readScheduledDay } from "../scripts/editorDay.ts";
import { add, targetIn, type AddOutcome, type AddTarget } from "../scripts/editorAdd.ts";
import { builtIndex } from "./builtIndex.ts";
import { rebuildIndex } from "./indexRebuild.ts";
import { EDITOR_ADD_PATH } from "./src/endpoints.ts";
import type { AddSubmitResult, RebuildResult } from "./src/editor/add.ts";
import { MAX_ADD_BODY_BYTES, addWriteRequest } from "./editorAddRequest.ts";
import { readCappedBody, sendJson } from "./editorTransport.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no `data/` directory, no artifact and no subprocess.
 *
 * `runAdds` is `scripts/editorAdd.ts`'s `add` — writes included. Keeping the
 * writes inside it rather than lifting them out to this caller is that module's
 * own decision and it survives a second caller intact: an add's whole point is
 * the write, both surfaces need it to happen server-side, and an `AddOutcome`
 * that merely *described* a write each renderer had to remember to perform would
 * be a bug waiting for the renderer that forgot. What this route adds is not a
 * fourth kind of write; it is the two acts that compose *after* the value comes
 * back, which is why `add` needed no new argument to be called from here.
 *
 * `openIndex` is a function and is called **after** `rebuild` resolves, which is
 * the whole reason it is not an index: it is how the day comes off the fresh
 * artifact rather than the one this process had already parsed.
 */
export interface EditorAddDeps {
  schedule: () => Schedule;
  runAdds: (words: string[], aim: AddTarget) => Promise<AddOutcome>;
  rebuild: () => Promise<RebuildResult>;
  openIndex: () => RhymeIndex;
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * Every refusal is a status and a sentence, and none of them is `next()`: this
 * path is the editor's alone, and falling through would hand a bad request the
 * static shell's HTML with a 200 on it — the one shape of failure worth ruling
 * out on a route whose success case writes to `data/` and rebuilds the index.
 *
 * The order of the checks is the order in which each can rule the Submit out:
 * the verb, then the size, then the batch, then whether the run covers the day
 * the batch is aimed at. Nothing is written until all four have passed, and a
 * rebuild that fails is reported *with* the outcome rather than in place of it —
 * the readings are on disk by then, and an editor told only "the build failed"
 * would retype a batch that had already landed.
 */
export function editorAddHandler(deps: EditorAddDeps) {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, {
        error: "Submit queued adds with POST. The queue itself lives in the browser.",
      });
      return;
    }

    void (async () => {
      const body = await readCappedBody(req, res, MAX_ADD_BODY_BYTES);
      if (body === null) return;

      const asked = addWriteRequest(body);
      if (!asked.ok) return sendJson(res, 400, { error: asked.error });

      let aim: AddTarget | null;
      try {
        aim = targetIn(deps.schedule(), asked.date);
      } catch (error) {
        return sendJson(res, 500, { error: `Could not read the schedule: ${said(error)}` });
      }
      if (aim === null) {
        // Not a malformed request and not the file's fault: the run simply does
        // not cover that day, so there is no Rhyme Key for the words to be aimed
        // at and nothing to write. The browser cannot reach this from a day it
        // is looking at, which is exactly why it is worth answering plainly.
        return sendJson(res, 400, {
          error: `No Daily Puzzle is scheduled for ${asked.date}, so there is no Rhyme Key to aim these words at.`,
        });
      }

      let outcome: AddOutcome;
      try {
        outcome = await deps.runAdds(asked.words, aim);
      } catch (error) {
        // What throws past `add` is a pinned source that would not read or a
        // supplement that would not take the append. Both name their own file,
        // so the cause is relayed whole and nothing is added to it — a second
        // sentence guessing at the remedy reads as two diagnoses of one
        // problem. Relaying is safe in a way it would not be on a deployed
        // route: the reader is the maintainer, and the paths are their own.
        return sendJson(res, 500, { error: `Could not add those words: ${said(error)}` });
      }

      const rebuilt = await deps.rebuild();
      const result: AddSubmitResult = {
        outcome,
        rebuilt,
        // A day is re-read only from an index that was actually rebuilt. See
        // `AddSubmitResult` for why a stale re-read is refused rather than
        // shown with a caveat on it.
        readout: rebuilt.ok ? readDay(deps, asked.date) : null,
      };
      sendJson(res, 200, result);
    })();
  };
}

/**
 * The day, off the artifact the rebuild just wrote.
 *
 * A day that will not read is not a failed Submit — the readings are written and
 * the index is built — so this answers `null` and lets the screen keep the day
 * it had, rather than throwing away a readout of the words that landed. The
 * editor's remedy is a reload, and the readout they need most is the one saying
 * what was written.
 */
function readDay(deps: EditorAddDeps, date: string): AddSubmitResult["readout"] {
  try {
    return readScheduledDay(deps.openIndex, deps.schedule(), date);
  } catch {
    return null;
  }
}

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reviewed schedule artifact, read per request rather than held — the same
 * call `editorDayPlugin.ts` makes, and for the same reasons: it is a small
 * hand-edited file, and `loadSchedule`'s `process.exit(1)` is the right answer
 * for a command and the wrong one for a dev server the player's shell is also
 * being served from.
 */
function readSchedule(): Schedule {
  const path = resolve(repoRoot, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) throw new Error(`${path} is not a readable schedule artifact.`);
  return parsed;
}

export function editorAddPlugin(): Plugin {
  return {
    name: "rhyme-bee-editor-add",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        EDITOR_ADD_PATH,
        editorAddHandler({
          schedule: readSchedule,
          runAdds: add,
          rebuild: () => rebuildIndex(repoRoot),
          openIndex: builtIndex,
        }),
      );
    },
  };
}
