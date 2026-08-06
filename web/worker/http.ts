/**
 * The bits of HTTP every endpoint on this Worker needs: a JSON reply, and a
 * request body read under a cap.
 *
 * They live together rather than in one route because the cap in particular is
 * security-relevant and subtle, and a second copy-pasted copy is a second thing
 * to get wrong. Each route chooses its own limit — an Appeal is six short
 * fields, a note is prose — but they count bytes the same way.
 */

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
