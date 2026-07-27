/**
 * The dev-only supplement-candidate endpoint. A Vite plugin that, during
 * `npm run dev` only (`apply: "serve"`; `configureServer` never runs in a
 * production build), serves `POST /api/supplement-candidate`: it appends a word
 * a maintainer flagged as *should-have-counted* to an append-only JSON Lines
 * queue (`data/supplement-candidates.jsonl`), for a later run to judge and format
 * into the committed supplement (ADR-0009).
 *
 * Capture only records; it makes no wordhood, pronunciation, or add-vs-correct
 * decision — that reasoning is the judge's, run against the queue offline. The
 * record shape and its serialisation are the pure `src/supplementCandidate.ts`;
 * this plugin is the thin IO over it.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  serialiseCandidate,
  type SupplementCandidate,
} from "../src/supplementCandidate.ts";

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

/** Coerce the request body into a candidate, defaulting the fields capture owns
 *  (the timestamp) so a client need only send the play context. Returns null if
 *  the word or seed is missing — there is nothing to judge without them. */
function toCandidate(body: unknown): SupplementCandidate | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.word !== "string" || b.word.trim() === "") return null;
  if (typeof b.seedWord !== "string" || typeof b.seedRhymeKey !== "string") return null;
  return {
    word: b.word.trim().toLowerCase(),
    seedWord: b.seedWord,
    seedRhymeKey: b.seedRhymeKey,
    reason: typeof b.reason === "string" ? (b.reason as SupplementCandidate["reason"]) : "not-a-known-word",
    engineRespelling: typeof b.engineRespelling === "string" ? b.engineRespelling : null,
    timestamp: new Date().toISOString(),
  };
}

export function supplementPlugin(): Plugin {
  return {
    name: "rhyme-bee-supplement-candidate",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/supplement-candidate", (req, res, next) => {
        if (req.method !== "POST") return next();
        void (async () => {
          try {
            const candidate = toCandidate(await readJson(req));
            if (!candidate) {
              return sendJson(res, 400, { error: "A word and its seed are required." });
            }
            await mkdir(dirname(QUEUE_PATH), { recursive: true });
            await appendFile(QUEUE_PATH, serialiseCandidate(candidate), "utf8");
            sendJson(res, 201, { word: candidate.word });
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
