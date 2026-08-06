/**
 * The should-have-counted endpoint: a player tapped "should count" on a
 * rejection, and this writes that report to object storage for the supplement
 * judge to work through later (ADR-0009).
 *
 * It is transport and nothing else. It does not judge — the verdict was reached
 * in the browser before this was ever called, and adjudication never crosses the
 * network (ADR-0013). It does not decide what a valid report is either: the
 * record shape, the validation and the object key all live in the pure
 * `src/supplementCandidate.ts`, which is where they can be tested without a
 * runtime. What is left here is: read a capped body, hand it over, write or
 * refuse.
 *
 * There is no rate limiting, deliberately (#114, Step 9). The URL is unlisted
 * and the worst case is a bucket that can be emptied; a cap here would be
 * reversing a recorded decision. Payload validation is a separate concern and is
 * applied in full.
 */

import {
  candidateFromReport,
  candidateKey,
  serialiseCandidate,
  MAX_REPORT_BYTES,
} from "../../src/supplementCandidate.ts";
import { json, readReport } from "./http.ts";
import type { Env } from "./env.ts";

export async function handleAppeal(request: Request, env: Env): Promise<Response> {
  const outcome = await readReport(request, {
    maxBytes: MAX_REPORT_BYTES,
    method: "Send an Appeal with POST.",
    tooLarge: "That report is too large.",
    notJson: "That report is not JSON.",
    // A refusal returns no candidate at all, so there is nothing partial to
    // write and the bucket is never touched.
    validate: (body) => candidateFromReport(body, new Date().toISOString()),
  });
  if (!outcome.ok) return outcome.response;
  const { candidate } = outcome.report;

  try {
    await env.APPEAL_QUEUE.put(candidateKey(candidate), serialiseCandidate(candidate), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // Whatever R2 said stays here. A caught error can carry a bucket name, an
    // account id or a signed URL, and none of that belongs in a public response.
    return json(500, { error: "Could not record that Appeal." });
  }

  return json(201, { word: candidate.word });
}
