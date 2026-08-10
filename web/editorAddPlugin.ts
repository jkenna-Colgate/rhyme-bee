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
 * quietly restore the band verdicts it had been withholding.
 *
 * ## The first act is skipped when there is nothing to write (#162)
 *
 * #161 refused a Submit with no words, so that a night of Tier judgements alone
 * never paid for a rebuild it did not need. It reached the wrong conclusion
 * from the right premise: the rebuild a night of Tier judgements needs is one
 * it very much does need, and the refusal made it unreachable from the browser
 * — the editor's only routes to it were queueing a word the day did not want,
 * or leaving the tool for a terminal.
 *
 * So an empty batch is now answered by asking `indexStaleness` the question
 * #161 left to a later ticket. Stale means rows were written since the last
 * build — a Tier verdict, a demotion, an earlier add — and the rebuild is
 * exactly what makes them real. Current means nothing is waiting, and the
 * refusal #161 wrote still stands, for the reason it was written.
 *
 * `runAdds` is not called at all on that path, rather than called with an empty
 * list. That is what makes "an empty Submit writes nothing" structural: the one
 * function in this handler that can write to `data/` is never entered, so the
 * claim does not rest on `add` being well behaved when handed nothing.
 *
 * The staleness read is a **dependency** rather than a direct call, for the
 * reason the other three acts are: a route whose refusal path can only be
 * exercised against the maintainer's real `dist-data/` is a route whose refusal
 * path is tested by whatever that directory happens to hold that day.
 *
 * ## What this route does not write
 *
 * No Tier verdict and no demotion. Those are `data/tier-overrides.csv` and
 * `data/demotions.txt`, both already written by the click that made them
 * (#159, #160) — by the time Submit runs they are on disk, and re-recording
 * them here would append rows nobody asked for. The deps below are the whole of
 * what this handler can reach, and neither file is among them —
 * `staleness` stats those two files among many and reads only the manifest;
 * `web/__tests__/editorAddEndpoint.test.ts` holds the two paths to account
 * across a real call rather than leaving the claim to this sentence, and holds
 * the empty Submit to account against all four written files.
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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { Schedule } from "../src/schedule.ts";
import { readScheduledDay } from "../scripts/editorDay.ts";
import { add, targetIn, type AddOutcome, type AddTarget } from "../scripts/editorAdd.ts";
import { indexStaleness, type IndexStaleness } from "../scripts/indexArtifact.ts";
import { builtIndex } from "./builtIndex.ts";
import { rebuildIndex } from "./indexRebuild.ts";
import { EDITOR_ADD_PATH } from "./src/endpoints.ts";
import type { AddSubmitResult, RebuildResult } from "./src/editor/add.ts";
import { MAX_ADD_BODY_BYTES, addWriteRequest } from "./editorAddRequest.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { readSchedule } from "./editorSchedule.ts";
import { relayCause, sendJson } from "./editorTransport.ts";
import { repoRoot } from "./repoRoot.ts";

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
  /**
   * Whether anything has been written since the artifact was built. Read only
   * on the empty-batch path, where it is the whole of the decision; a batch
   * with words in it is pending work by definition and needs nobody's opinion
   * on the matter.
   */
  staleness: () => IndexStaleness;
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped.
 *
 * The order of the checks is the order in which each can rule the Submit out:
 * the verb, then the size — both `web/editorRoute.ts`'s — then the batch, then
 * — for a batch with words in it — whether the run covers the day they are
 * aimed at, and for an empty one whether anything is pending at all. Nothing is
 * written until all of them have passed, and a rebuild that fails is reported
 * *with* the outcome rather than in place of it — the readings are on disk by
 * then, and an editor told only "the build failed" would retype a batch that
 * had already landed.
 *
 * ## Four `try` scopes, four sentences, and why none of them is shared
 *
 * This is the route the shared skeleton was kept narrow for. A skeleton owning
 * one `try` around the whole of the work could not have expressed what is
 * below, and flattening it would have cost the editor four distinct diagnoses:
 *
 * - the **staleness read** on the empty batch, which relays **no** cause,
 *   because its causes are absolute paths under `dist-data/`;
 * - the **schedule read**, which relays its cause;
 * - the **add itself**, which relays its cause;
 * - the **re-read** in `readDay`, which answers `null` rather than any status
 *   at all, because a day that will not read is not a failed Submit.
 *
 * Each is scoped to exactly the call it is about, and the code between them —
 * the `aim === null` 400, the `!stale` 400, the rebuild — is deliberately
 * outside every one of them.
 */
export function editorAddHandler(deps: EditorAddDeps) {
  return async (_req: IncomingMessage, res: ServerResponse, body: string): Promise<void> => {
    const asked = addWriteRequest(body);
    if (!asked.ok) return sendJson(res, 400, { error: asked.error });

    let outcome: AddOutcome | null = null;
    if (asked.words.length === 0) {
      // The empty Submit (#162). Nothing is aimed anywhere, no schedule is
      // consulted and `runAdds` is never reached — the only question is
      // whether the rebuild below has anything to fold in.
      let stale: boolean;
      try {
        stale = deps.staleness().stale;
      } catch {
        // The staleness read is the only thing standing between an empty
        // Submit and a rebuild for nothing, and a read that threw has not
        // answered. Refusing is the cheap error: the editor queues a word or
        // runs the build themselves. No cause is relayed, because the causes
        // here are absolute paths under `dist-data/`.
        return sendJson(res, 500, {
          error: "Could not tell whether the Rhyme Index is stale, so nothing was rebuilt.",
        });
      }
      if (!stale) {
        return sendJson(res, 400, {
          error:
            "Nothing is pending: no words are queued and the Rhyme Index already holds " +
            "everything written to data/. Submit rebuilds the index, which is not worth paying for nothing.",
        });
      }
    } else {
      let aim: AddTarget | null;
      try {
        aim = targetIn(deps.schedule(), asked.date);
      } catch (error) {
        // The second of the four scopes, and the first of the two that relay.
        return relayCause(res, "Could not read the schedule", error);
      }
      if (aim === null) {
        // Not a malformed request and not the file's fault: the run simply
        // does not cover that day, so there is no Rhyme Key for the words to
        // be aimed at and nothing to write. The browser cannot reach this
        // from a day it is looking at, which is exactly why it is worth
        // answering plainly.
        return sendJson(res, 400, {
          error: `No Daily Puzzle is scheduled for ${asked.date}, so there is no Rhyme Key to aim these words at.`,
        });
      }

      try {
        outcome = await deps.runAdds(asked.words, aim);
      } catch (error) {
        // What throws past `add` is a pinned source that would not read or a
        // supplement that would not take the append, and both name their own
        // file. `relayCause` argues why the cause travels whole — and the
        // staleness scope above deliberately does not use it, because its
        // causes are absolute paths under `dist-data/`.
        return relayCause(res, "Could not add those words", error);
      }
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
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorAddSpec(deps: EditorAddDeps): EditorRouteSpec {
  return {
    path: EDITOR_ADD_PATH,
    verbs: ["POST"],
    refusal: "Submit queued adds with POST. The queue itself lives in the browser.",
    cap: MAX_ADD_BODY_BYTES,
    handle: editorAddHandler(deps),
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

export function editorAddPlugin(): Plugin {
  return editorRoute(
    editorAddSpec({
      schedule: readSchedule,
      runAdds: add,
      rebuild: () => rebuildIndex(repoRoot),
      openIndex: builtIndex,
      staleness: () => indexStaleness(repoRoot),
    }),
  );
}
