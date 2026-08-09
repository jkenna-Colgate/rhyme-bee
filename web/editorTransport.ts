/**
 * The transport the three Editor's Pass routes share: writing a JSON reply, and
 * reading a request body under a cap. `editorDayPlugin.ts`, `editorTierPlugin.ts`
 * and `editorDemotionPlugin.ts` each carried their own copy of both — the day
 * route's `readCappedBody` even discarded the body it read, since a `GET` has
 * none to use — and by the third copy the duplication stopped being a coincidence
 * three routes could each reasonably arrive at and started being one function
 * not written yet. Issues #161–#163 add more routes to this same shape, so it is
 * shared before a fourth copy makes the case again.
 *
 * The **cap itself** stays out of here, on purpose, and stays declared in each
 * route's own request module (`editorDayRequest.ts`, `editorTierRequest.ts`,
 * `editorDemotionRequest.ts`) — each with a doc comment arguing that route's
 * ceiling is sized to what that route carries, not to what a caller might send,
 * and that tying two routes' caps together would mean a change to either being
 * reasoned about as a change to both. That argument is about the **constants**;
 * it says nothing about the ~35 lines that read the socket and enforce whichever
 * number they are handed, which is why `readCappedBody` takes the cap as a
 * parameter rather than importing one.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * Read a request body, refusing anything over `cap` as the bytes arrive rather
 * than buffering the lot and measuring afterwards. `Content-Length` is an early
 * hint and never a fact — it is the sender's claim about the sender's own body —
 * so an oversize body that declared itself small is caught by the count instead.
 *
 * Resolves the body, or `null` when the request was refused; a `null` means the
 * refusal has already been sent and the caller returns. A `GET` route with no use
 * for the body — `editorDayPlugin.ts` is the one so far — reads it anyway and
 * discards it: the alternative was the day route's own `withinCap`, a second
 * function that counted the same bytes without keeping them, which is exactly
 * the kind of near-duplicate this module exists to not have twice.
 */
export function readCappedBody(
  req: IncomingMessage,
  res: ServerResponse,
  cap: number,
): Promise<string | null> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > cap) {
    sendJson(res, 413, { error: "That request is too large." });
    return Promise.resolve(null);
  }

  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > cap) {
        req.destroy();
        sendJson(res, 413, { error: "That request is too large." });
        settle(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(size > cap ? null : Buffer.concat(chunks).toString("utf8")));
    // A connection that broke mid-body is not a request to answer, and the
    // response went with it — settle so nothing is left pending.
    req.on("error", () => settle(null));
  });
}
