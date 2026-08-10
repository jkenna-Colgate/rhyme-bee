/**
 * The socket ceremony every dev-only Editor's Pass route performs, written once.
 *
 * The five editor endpoints — day, status, demotion, tier, add — were five
 * copies of one plugin. Each declared `apply: "serve"`, mounted a middleware on
 * a path, named a `next` it never called, refused the wrong verb with an `Allow`
 * header and a 405, wrapped its work in `void (async () => {…})()` and read the
 * body under a cap before doing anything else. That was the same twenty-eight
 * lines five times.
 *
 * ## Why it is shared, and it is not the line count
 *
 * ADR-0016 makes the dev-only property of these routes **structural**: an editor
 * route surviving into a production build would be a write path from the public
 * internet into `data/`. Three things make that impossible rather than
 * unlikely — `apply: "serve"` so `configureServer` never runs in a build,
 * `vite.config.ts` naming the build's inputs so `editor.html` is never bundled,
 * and no Worker route answering any of these paths. The first of those three is
 * this module's line
 * {@link editorRoute}, and it is now stated once instead of five times.
 *
 * The second guarantee is the same shape: **an editor route always answers, and
 * the answer is always JSON.** It never calls `next()`. Falling through would
 * hand a bad request the static shell's HTML with a 200 on it, and a failure
 * that reads as a success is the one shape of failure worth ruling out on paths
 * whose success case writes to `data/`. Five copies agreeing about that held
 * because five copies agreed; one function holding it cannot disagree with
 * itself.
 *
 * ## What this module deliberately does not own
 *
 * **Parsing, and the catch-to-500.** A skeleton with one parser slot and one
 * implied `try` around the work would fit three of the five routes and misshape
 * the other two. Status parses nothing at all — it has no date, no words and no
 * verdict — and scopes its `try` around the staleness read *only*, leaving the
 * git read and the compose outside it. Add has **four** separate `try` scopes
 * with four different sentences, two of which relay no cause because their
 * causes are absolute paths under `dist-data/`. Forcing either into a uniform
 * parse-then-catch would mean flattening add's four deliberate error sentences
 * into one, or leaving two routes opted out of the skeleton — which is the
 * duplication back again with an abstraction sitting on top of it.
 *
 * So `handle` receives the already-read, already-capped body and does the rest
 * itself: it reads `req.method` where it dispatches on the verb (demotion,
 * tier), reads `req.url` where it parses a query (day, tier), and keeps its own
 * `try` scopes exactly where they already are. {@link relayCause} in
 * `web/editorTransport.ts` shares the *sentence* those catches write without
 * sharing their scope.
 *
 * **The cap.** It is a spec field passed in, never a constant declared here.
 * `web/editorTransport.ts` records the argument at length: each route's ceiling
 * is sized to what that route carries, and tying two routes' caps together would
 * mean a change to either being reasoned about as a change to both. Sharing the
 * ~35 lines that enforce whichever number they are handed was never the same
 * decision as sharing the number, and this module does not reopen it.
 *
 * **`supplementPlugin.ts` is not a client of this module**, though it is a
 * dev-only Vite plugin serving a path. It is the deployed Appeal path's dev
 * half: a Worker route answers the same path in production, so it has a
 * production surface by design, and it falls through to `next()` on a verb it
 * does not answer. Both of those are exactly what an editor route must not do.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { readCappedBody, sendJson } from "./editorTransport.ts";

/**
 * The middleware shape connect hands a request. `next` is named in the
 * signature only so that it is visibly never called; it is optional because
 * every test of these routes drives the middleware directly and a route that
 * cannot fall through has no use for it.
 */
export type EditorMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  _next?: () => void,
) => void;

/** One editor route, as everything but its own work. */
export interface EditorRouteSpec {
  /** The path the plugin mounts on, from `web/src/endpoints.ts`. */
  path: string;

  /**
   * The verbs this route answers, in the order the `Allow` header should list
   * them. Non-empty by type: a route that answers nothing is a mount that
   * refuses everything, which is a mistake rather than a configuration.
   */
  verbs: readonly [string, ...string[]];

  /**
   * The 405 sentence. Each route keeps its own — they are well written, they
   * say what the route is *for* rather than what it refused, and the difference
   * between "Read a day with GET." and "Submit queued adds with POST. The queue
   * itself lives in the browser." is worth more than one shared sentence would
   * be.
   */
  refusal: string;

  /** What the route will read of a body before answering 413. See the note above. */
  cap: number;

  /**
   * The route's own work, over a body that has already been read and already
   * been found to be within the cap. Never reached on a refused request.
   */
  handle: (req: IncomingMessage, res: ServerResponse, body: string) => Promise<void> | void;
}

/**
 * What the plugin mounts, exposed so a test can drive a route without standing
 * up a dev server.
 *
 * The order of the two checks is the order in which each can rule a request
 * out — the verb, then the size — and neither reaches `handle`, which is what
 * "every refusal does nothing" means on the three routes that write to `data/`.
 *
 * The body is read even on a `GET`, which carries none. Connect hands a
 * middleware a live stream whether or not the route wants one, and the read is
 * there to enforce the cap rather than to produce a value; day and status
 * ignore the string it resolves to. `web/editorTransport.ts` argues that at
 * length, including why the alternative — a second function that counted the
 * same bytes without keeping them — was not worth having.
 */
export function editorMiddleware(spec: EditorRouteSpec): EditorMiddleware {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    // The two-verb routes already read an absent method as `GET`, which is the
    // forgiving reading and the right one: a request with no method is not a
    // request some other verb was meant by.
    const method = req.method ?? "GET";
    if (!spec.verbs.includes(method)) {
      res.setHeader("Allow", spec.verbs.join(", "));
      sendJson(res, 405, { error: spec.refusal });
      return;
    }

    void (async () => {
      // `null` is a refusal already sent — the 413 — and the caller returns.
      const body = await readCappedBody(req, res, spec.cap);
      if (body === null) return;

      try {
        await spec.handle(req, res, body);
      } catch (error) {
        // Not the route's error reporting: every route catches what its own
        // work can throw, in the scopes it chose, with a sentence that names
        // what failed. Reaching here means something threw *outside* all of
        // them, which is a bug in the route rather than a condition it handles.
        //
        // It is caught anyway because the alternative is worse than a wrong
        // sentence: an unhandled rejection inside the `void (async …)()` above
        // leaves the socket open with nothing on it, and the editor's screen
        // hangs rather than saying anything. Answering *something* is the
        // guarantee this module exists to make. The cause is relayed on the
        // same reasoning as `relayCause` — the reader is the maintainer.
        if (!res.writableEnded) {
          sendJson(res, 500, {
            error: `That request could not be answered: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
    })();
  };
}

/**
 * The Vite plugin, mounted and dev-only.
 *
 * `apply: "serve"` is the load-bearing line: `configureServer` never runs in a
 * production build, so there is no build in which this path exists. See the
 * module comment.
 */
export function editorRoute(spec: EditorRouteSpec): Plugin {
  return {
    name: pluginName(spec.path),
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(spec.path, editorMiddleware(spec));
    },
  };
}

/**
 * The plugin's name, from the path it answers: `/api/editor/day` becomes
 * `rhyme-bee-editor-day`, which is the name that plugin already had. Derived
 * rather than a sixth spec field because a name that disagreed with the path
 * would be a name that lies in a stack trace, and there is no reason two routes
 * on two paths should ever want the same one.
 */
function pluginName(path: string): string {
  return `rhyme-bee-${path.replace(/^\/api\//, "").replaceAll("/", "-")}`;
}
