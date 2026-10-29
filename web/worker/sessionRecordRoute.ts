/**
 * The Session Record endpoint (ADR-0019): the player's browser sends a copy of
 * a Daily Puzzle Session after the fact, and this writes it to the private
 * bucket the Appeals use, under its own prefix.
 *
 * Transport and nothing else, like `appealRoute.ts` beside it. It does not
 * judge (ADR-0013), and it does not decide what a valid record is: the shape,
 * the validation and the object key live in the pure `src/sessionRecord.ts`.
 * The key is derived from the record's date and per-Session id, so a Session
 * sent again as it grows overwrites its earlier copy.
 *
 * It is reporting, so it may fail freely: a refusal or an outage costs the
 * player nothing, and the browser says nothing about it. The client IP reaches
 * the shared envelope's limiter key and nothing else; no header is written to
 * the bucket.
 */

import {
  MAX_RECORD_BYTES,
  recordFromBody,
  serialiseSessionRecord,
  sessionRecordKey,
} from "../../src/sessionRecord.ts";
import { json, readReport } from "./http.ts";
import type { Env } from "./env.ts";

export async function handleSessionRecord(request: Request, env: Env): Promise<Response> {
  const outcome = await readReport(request, {
    maxBytes: MAX_RECORD_BYTES,
    limiter: env.SESSION_RECORD_LIMITER,
    method: "Send a Session Record with POST.",
    tooLarge: "That Session Record is too large.",
    notJson: "That Session Record is not JSON.",
    limited: "Too many Session Records just now.",
    validate: recordFromBody,
  });
  if (!outcome.ok) return outcome.response;
  const { record } = outcome.report;

  try {
    await env.APPEAL_QUEUE.put(sessionRecordKey(record), serialiseSessionRecord(record), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // Whatever R2 said stays here, for the reason `appealRoute.ts` gives.
    return json(500, { error: "Could not record that Session." });
  }

  return json(201, {});
}
