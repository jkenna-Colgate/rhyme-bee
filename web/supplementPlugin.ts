/**
 * The dev-only supplement-candidate endpoint. A Vite plugin that, during
 * `npm run dev` only (`apply: "serve"`; `configureServer` never runs in a
 * production build), serves `POST /api/supplement-candidate`: it appends a word
 * a maintainer Appealed as *should-have-counted* to an append-only JSON Lines
 * queue (`data/supplement-candidates.jsonl`), for a later run to judge and format
 * into the committed supplement (ADR-0009).
 *
 * Capture only records; it makes no wordhood, pronunciation, or add-vs-correct
 * decision — that reasoning is the judge's, run against the queue offline. The
 * record shape, its validation and its serialisation are the pure
 * `src/supplementCandidate.ts`; this plugin is the thin IO over it, as is the
 * deployed Worker route in `web/worker/appealRoute.ts` that answers the same path
 * for players.
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

export function supplementPlugin(): Plugin {
  return {
    name: "rhyme-bee-supplement-candidate",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(APPEAL_PATH, (req, res, next) => {
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
            await mkdir(dirname(QUEUE_PATH), { recursive: true });
            await appendFile(QUEUE_PATH, serialiseCandidate(report.candidate), "utf8");
            sendJson(res, 201, { word: report.candidate.word });
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "Failed to queue candidate.",
            });
          }
        })();
      });
    },
  };
}
