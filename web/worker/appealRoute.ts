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
 * Flooding it is refused by `APPEAL_LIMITER`, whose budget is declared in
 * `wrangler.jsonc` and enforced in the shared envelope. #114 Step 9 decided
 * against a limit for the playtest, on the premises that the URL was unlisted
 * and the bucket private; publishing the repository ended both (#213). Payload
 * validation is a separate concern and is applied in full.
 *
 * Every refusal sentence here is written for a player, and says "Appeal"
 * because a player's act is one. The rule that no sentence the puzzles editor
 * is shown may say it (argued at `web/src/endpoints.ts`) stops short of this
 * file: the Editor's Pass posts to this same path (#163), but in dev that path
 * is answered by `web/supplementPlugin.ts`, and `editor.html` is not a build
 * input (`web/vite.config.ts`), so nothing an editor reads was ever written
 * here.
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
    limiter: env.APPEAL_LIMITER,
    method: "Send an Appeal with POST.",
    tooLarge: "That report is too large.",
    notJson: "That report is not JSON.",
    limited: "Too many Appeals just now. Try again in a minute.",
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
