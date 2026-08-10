/**
 * The dev-only supplement-candidate endpoint. A Vite plugin that, during
 * `npm run dev` only (`apply: "serve"`; `configureServer` never runs in a
 * production build), serves `POST /api/supplement-candidate`: it appends a word
 * a maintainer Appealed as *should-have-counted* to an append-only JSON Lines
 * queue (`data/supplement-candidates.jsonl`), for a later run to judge and format
 * into the committed supplement (ADR-0009).
 *
 * Two callers reach it in dev: the game's own should-have-counted button, and
 * the Editor's Pass, which records a disagreement when the index holds a typed
 * word on a Rhyme Key other than the day's (#163). Neither is a second shape —
 * both post the five fields `candidateFromReport` recognises, and this endpoint
 * cannot tell them apart, which is the point: the judge reads one queue.
 *
 * Capture only records; it makes no wordhood, pronunciation, or add-vs-correct
 * decision — that reasoning is the judge's, run against the queue offline. The
 * record shape, its validation and its serialisation are the pure
 * `src/supplementCandidate.ts`; this plugin is the thin IO over it, as is the
 * deployed Worker route in `web/worker/appealRoute.ts` that answers the same path
 * for players.
 *
 * ## Why the handler takes its append rather than owning a path
 *
 * The queue was a module constant resolved against `data/`, which made this the
 * one route on the dev server with no test: driving it would have appended to
 * the maintainer's own queue, and a route test that dirties committed data is
 * worse than none. It stayed untested through the slice that gave it a second
 * caller (#163) — a gap that slice widened rather than found, and that
 * ADR-0016 and the Testing section of `AGENTS.md` both say should not stand.
 *
 * So the effect is a dependency, exactly as the four editor plugins take theirs
 * (`web/editorDayPlugin.ts` and the three beside it): `append` is the one thing
 * this route does to the world, and a test hands it an array. The *path* is not
 * the dependency, because injecting a path only moves the write to a temporary
 * directory and leaves a transport test doing filesystem work to assert on
 * transport. `QUEUE_PATH` below is unchanged and is still what the plugin wires
 * up, so nothing about the shipped dev endpoint moved.
 *
 * The clock is not injected either. The timestamp is the endpoint's to set —
 * that is `candidateFromReport`'s rule, and the reason the wire carries five
 * fields and the record six — so a test that pinned the instant would be
 * asserting on the one value this route is trusted to take from the world.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { candidateFromReport, serialiseCandidate } from "../src/supplementCandidate.ts";
import { APPEAL_PATH } from "./src/endpoints.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = resolve(rootDir, "../data/supplement-candidates.jsonl");

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Malformed request body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * What the handler needs from the world: one append of one serialised line.
 *
 * There is no read among them, and that is the endpoint's shape rather than an
 * omission — the queue is append-only, is judged offline and is never shown to
 * whoever posted to it, so nothing here has a reason to open the file it writes.
 */
export interface SupplementDeps {
  /** Append one already-serialised JSON Lines record to the queue. */
  append: (line: string) => Promise<void>;
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * A non-`POST` falls through to `next()` rather than answering 405. That is
 * where this route stands apart from both its neighbours — the four editor
 * plugins answer 405 and never call `next`, and the deployed half
 * (`web/worker/appealRoute.ts`) refuses the verb outright with "Send an Appeal
 * with POST." It is left standing rather than corrected here: this is a findings
 * commit over the disagreement recorder, changing a dev route's answer to a verb
 * nothing sends is a behaviour change with no finding behind it, and the verb
 * that matters to a player is the deployed one. The fall-through is pinned by a
 * test so the divergence is on the record and a later tidy-up is a decision
 * rather than an accident.
 */
export function supplementHandler(deps: SupplementDeps) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.method !== "POST") return next();
    void (async () => {
      try {
        // Same validation the deployed Worker applies, from the module that
        // owns the record — so a report the endpoint would refuse is refused
        // here too, and dev is not a more forgiving judge than production.
        const report = candidateFromReport(await readJson(req), new Date().toISOString());
        if (!report.ok) {
          return sendJson(res, 400, { error: report.error });
        }
        await deps.append(serialiseCandidate(report.candidate));
        sendJson(res, 201, { word: report.candidate.word });
      } catch (error) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : "Failed to queue candidate.",
        });
      }
    })();
  };
}

export function supplementPlugin(): Plugin {
  return {
    name: "rhyme-bee-supplement-candidate",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        APPEAL_PATH,
        supplementHandler({
          append: async (line) => {
            await mkdir(dirname(QUEUE_PATH), { recursive: true });
            await appendFile(QUEUE_PATH, line, "utf8");
          },
        }),
      );
    },
  };
}
