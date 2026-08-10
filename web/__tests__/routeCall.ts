/**
 * A fake socket, for driving a connect middleware without a dev server.
 *
 * Six suites hand-built this before #170 — the five editor endpoints and
 * `supplementEndpoint.test.ts` — and the six copies were the same forty-eight
 * lines: a `Readable.from` request with a method, a url and headers pinned on
 * it, a `ServerResponse` literal cast through `unknown` because a real one
 * wants a socket, an `Answered` record the assertions read, and a `next` that
 * sets a flag rather than doing anything, so that "this route never falls
 * through" is a thing a test can *see*. `editorRoute.test.ts` would have been
 * the seventh, which is what settled it: a copy written *knowing* it was the
 * seventh is not a coincidence six suites each reasonably arrived at.
 *
 * It is one adapter now, and the seventh copy was never written. Not for the
 * ~288 lines the six came to: for the same reason
 * `web/editorRoute.ts` is one skeleton. A hand-built fake is a claim about what
 * the real socket does, and six copies of a claim are six chances for one of
 * them to be quietly wrong — a `setHeader` that records nothing, an `end` that
 * settles before the body is on it — while its suite goes on passing.
 * `supplementEndpoint.test.ts`'s copy had already drifted: no headers at all,
 * and a `setHeader` that dropped them.
 *
 * ## What it is not
 *
 * It is not a route skeleton and takes no spec. `supplementPlugin.ts` uses this
 * adapter and must never use `editorRoute.ts`: it is the deployed Appeal path's
 * dev half, a Worker answers the same path in production, and it falls through
 * to `next()` on a verb it does not answer. Sharing a *test* fake with the
 * editor routes says nothing about sharing their guarantees, which is exactly
 * why the fall-through below is recorded rather than forbidden.
 */

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

/** What the route did, as the assertions read it. */
export interface Answered {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Whether the route called `next()` — a fall-through, not an answer. */
  nexted: boolean;
}

/**
 * A connect middleware, with `next` required.
 *
 * The editor routes declare it optional (`_next?`, named only to be visibly
 * never called) and `supplementHandler` declares it required, because it calls
 * it. A required parameter here accepts both.
 */
export type RouteUnderTest = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void;

export interface CallOptions {
  method?: string;
  /**
   * The url the middleware sees. `server.middlewares.use(PATH, fn)` strips the
   * mounted prefix first, so this is what survives that: `/`, with any query
   * still attached.
   */
  url?: string;
  body?: string;
  headers?: Record<string, string>;
}

/** Call a route the way connect does, and resolve once it has answered. */
export function callRoute(
  route: RouteUnderTest,
  options: CallOptions = {},
): Promise<Answered> {
  const body = options.body ?? "";
  const req = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as IncomingMessage;
  req.method = options.method ?? "GET";
  req.url = options.url ?? "/";
  req.headers = options.headers ?? {};

  const answered: Answered = { status: 0, headers: {}, body: "", nexted: false };
  let ended = false;
  let finish: () => void;
  const done = new Promise<void>((settle) => (finish = settle));
  const res = {
    set statusCode(value: number) {
      answered.status = value;
    },
    get statusCode() {
      return answered.status;
    },
    setHeader(name: string, value: string) {
      answered.headers[name] = value;
    },
    // Modelled because a route's last-resort catch asks: a handler that
    // answered and *then* threw must not have a second reply written over it.
    get writableEnded() {
      return ended;
    },
    end(payload?: string) {
      answered.body = payload ?? "";
      ended = true;
      finish();
    },
  } as unknown as ServerResponse;

  route(req, res, () => {
    answered.nexted = true;
    finish();
  });
  return done.then(() => answered);
}
