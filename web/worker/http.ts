/**
 * The bits of HTTP every endpoint on this Worker needs: a JSON reply, a
 * request body read under a cap, and the envelope that reads, parses and
 * validates a POST body — refuse anything but POST, refuse a caller over its
 * rate limit, refuse an oversize body, refuse unparseable JSON, then hand the
 * parsed value to the route's own validator.
 *
 * They live together rather than in one route because the cap in particular is
 * security-relevant and subtle, and a second copy-pasted copy is a second thing
 * to get wrong. Each route chooses its own cap, its own limiter and its own
 * validator — an Appeal is six short fields, a note is prose — but the sequence
 * around them, and the way bytes are counted, is the same for both.
 */

import type { RateLimiter } from "./env.ts";

export function json(
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Read the body, or refuse it — counting bytes as they arrive and stopping at
 * `maxBytes`, rather than buffering whatever was sent and measuring afterwards.
 * `Content-Length` is taken as an early hint when it is offered, but never
 * trusted: a declared size is the sender's claim about the sender's own body,
 * and a request that does not declare one at all is still an ordinary request.
 *
 * Returns `null` for a body that is over the cap or absent, which the routes
 * report the same way — an endpoint that is only ever called by the game has
 * nothing useful to say about a request the game would not make.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** A validation failure, structurally — what every route's own `Validated<Key, T>` refusal looks like. */
interface Refused {
  ok: false;
  error: string;
}

/** The wording a route supplies for each way `readReport` can refuse a request. */
export interface ReportMessages {
  /** Answers a non-POST request, e.g. `"Send an Appeal with POST."` */
  method: string;
  /** Answers a body over the cap, e.g. `"That report is too large."` */
  tooLarge: string;
  /** Answers a body that is not valid JSON, e.g. `"That report is not JSON."` */
  notJson: string;
  /** Answers a caller over its rate limit, e.g. `"Too many Appeals just now."` */
  limited: string;
}

/**
 * Who a limit is counted against: the client IP, as Cloudflare puts it on every
 * request it proxies. The value is read here, handed to the limiter and
 * dropped — it is never stored, logged, or written to a bucket or an issue
 * (#213).
 *
 * A request carrying no such header did not arrive through the edge, so there
 * is no client to attribute it to. Those share one key rather than skipping the
 * check, because the alternative is an unlimited path that anything reaching
 * the Worker directly could take.
 */
function limitKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unattributed";
}

/**
 * Read, parse and validate a POST body: reject anything but POST, reject a
 * caller over `limiter`'s budget, read the body under `maxBytes`, parse it as
 * JSON, then hand the parsed value to `validate`. This is the sequence
 * `appealRoute.ts` and `feedbackRoute.ts` both repeated verbatim before #122 —
 * what moves here is that sequence, not the decisions either route makes with
 * it. Each route still supplies its own cap, its own limiter, its own validator
 * and its own wording for what went wrong.
 *
 * The limit is checked after the method and before the body read, so a flood is
 * refused without the Worker paying to read what it sent (#213).
 *
 * Returns the validated report, or the `Response` the route should return as
 * it is — a refusal already has its status and message chosen, so the caller
 * never re-decides one.
 */
export async function readReport<Report extends { ok: true } | Refused>(
  request: Request,
  config: ReportMessages & {
    maxBytes: number;
    limiter: RateLimiter;
    validate: (body: unknown) => Report;
  },
): Promise<{ ok: true; report: Exclude<Report, Refused> } | { ok: false; response: Response }> {
  if (request.method !== "POST") {
    return { ok: false, response: json(405, { error: config.method }, { Allow: "POST" }) };
  }

  const { success } = await config.limiter.limit({ key: limitKey(request) });
  if (!success) return { ok: false, response: json(429, { error: config.limited }) };

  const body = await readCappedBody(request, config.maxBytes);
  if (body === null) return { ok: false, response: json(413, { error: config.tooLarge }) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, response: json(400, { error: config.notJson }) };
  }

  const result = config.validate(parsed);
  if (!result.ok) {
    return { ok: false, response: json(400, { error: (result as Refused).error }) };
  }
  return { ok: true, report: result as Exclude<Report, Refused> };
}
