/**
 * The socket ceremony the five dev-only editor routes share, tested once
 * instead of five times.
 *
 * What is under test here is the part `web/editorRoute.ts` took over: the verb
 * check and its `Allow` header, the body cap, that `next()` is never called on
 * any path, and that a route always answers even when its own handler does not.
 * The per-route suites keep their own 405 *sentence* — the sentences differ and
 * saying what a route is for is the point of them — and keep everything about
 * the work each route does. Only the mechanism moved here.
 *
 * This is also the first test `web/editorTransport.ts` has ever had. Its
 * `readCappedBody` was covered five times over as a side effect of testing five
 * routes, which is coverage of a shared function by accident rather than on
 * purpose; the two 413 paths it distinguishes — the `Content-Length` claim and
 * the byte count that catches a claim that lied — are asserted below as its own
 * behaviour.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { editorMiddleware, editorRoute, type EditorRouteSpec } from "../editorRoute.ts";
import { relayCause } from "../editorTransport.ts";
import { callRoute as call } from "./routeCall.ts";


/**
 * A route that records what reached it, so "the handler was never entered" is
 * asserted rather than inferred from the status code.
 */
function route(overrides: Partial<EditorRouteSpec> = {}) {
  const reached: string[] = [];
  const spec: EditorRouteSpec = {
    path: "/api/editor/example",
    verbs: ["GET"],
    refusal: "Read the example with GET.",
    cap: 32,
    handle: (_req, res, body) => {
      reached.push(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ saw: body }));
    },
    ...overrides,
  };
  return { middleware: editorMiddleware(spec), reached, spec };
}

describe("the verb a route answers", () => {
  it("answers a verb the route names, and never falls through", async () => {
    const { middleware, reached } = route();
    const answered = await call(middleware, { method: "GET" });

    expect(answered.status).toBe(200);
    expect(answered.nexted).toBe(false);
    expect(reached).toEqual([""]);
  });

  it("refuses every other verb with the route's own sentence, reaching no handler", async () => {
    const { middleware, reached } = route();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      const answered = await call(middleware, { method });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET");
      expect(JSON.parse(answered.body)).toEqual({ error: "Read the example with GET." });
      expect(answered.nexted).toBe(false);
    }
    expect(reached).toEqual([]);
  });

  it("lists every named verb in Allow, in the order the route named them", async () => {
    const { middleware } = route({
      verbs: ["GET", "POST"],
      refusal: "Read it with GET, write it with POST.",
    });
    const answered = await call(middleware, { method: "DELETE" });

    expect(answered.status).toBe(405);
    expect(answered.headers["Allow"]).toBe("GET, POST");
    expect(JSON.parse(answered.body).error).toBe("Read it with GET, write it with POST.");
  });

  it("answers each of a two-verb route's verbs", async () => {
    const { middleware, reached } = route({ verbs: ["GET", "POST"] });
    for (const method of ["GET", "POST"]) {
      expect((await call(middleware, { method })).status).toBe(200);
    }
    expect(reached).toHaveLength(2);
  });

  it("reads a request with no method at all as a GET", async () => {
    // Connect always sets one; the two-verb routes already took this reading,
    // and a request with no method is not a request some other verb was meant by.
    const { middleware } = route();
    const answered = await call(middleware, { method: undefined });

    expect(answered.status).toBe(200);
  });

  it("refuses the wrong verb with JSON, so no refusal reads as the shell's HTML", async () => {
    const { middleware } = route();
    const answered = await call(middleware, { method: "POST" });

    expect(answered.headers["Content-Type"]).toBe("application/json");
  });
});

describe("the body cap", () => {
  it("hands the handler a body within the cap", async () => {
    const { middleware, reached } = route({ verbs: ["POST"] });
    const answered = await call(middleware, { method: "POST", body: "x".repeat(32) });

    expect(answered.status).toBe(200);
    expect(reached).toEqual(["x".repeat(32)]);
  });

  it("refuses a declared size over the cap before a byte of it arrives", async () => {
    const { middleware, reached } = route({ verbs: ["POST"] });
    const answered = await call(middleware, {
      method: "POST",
      headers: { "content-length": "33" },
    });

    expect(answered.status).toBe(413);
    expect(JSON.parse(answered.body)).toEqual({ error: "That request is too large." });
    expect(reached).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    // `Content-Length` is the sender's claim about the sender's own body, so
    // the count is what actually holds the ceiling.
    const { middleware, reached } = route({ verbs: ["POST"] });
    const answered = await call(middleware, {
      method: "POST",
      body: "x".repeat(33),
      headers: { "content-length": "4" },
    });

    expect(answered.status).toBe(413);
    expect(reached).toEqual([]);
  });

  it("refuses an oversize body that declared nothing", async () => {
    const { middleware, reached } = route({ verbs: ["POST"] });
    const answered = await call(middleware, { method: "POST", body: "x".repeat(33) });

    expect(answered.status).toBe(413);
    expect(reached).toEqual([]);
  });

  it("never falls through on a refused body", async () => {
    const { middleware } = route({ verbs: ["POST"] });
    const answered = await call(middleware, { method: "POST", body: "x".repeat(33) });

    expect(answered.nexted).toBe(false);
  });

  it("reads and discards the body of a GET, which is what the cap is there for", async () => {
    // Day and status answer `GET` and use no body; the read is only ever the
    // cap being enforced against a stream connect hands them regardless.
    const { middleware, reached } = route();
    const within = await call(middleware, { method: "GET", body: "x".repeat(8) });
    expect(within.status).toBe(200);
    expect(reached).toEqual(["x".repeat(8)]);

    const over = await call(middleware, { method: "GET", body: "x".repeat(33) });
    expect(over.status).toBe(413);
  });
});

describe("a route that does not answer for itself", () => {
  /** The backstop writes its cause here, so every test below reads it. */
  function console_() {
    return vi.spyOn(console, "error").mockImplementation(() => {});
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a handler that throws synchronously rather than leaving the socket open", async () => {
    console_();
    const { middleware } = route({
      handle: () => {
        throw new Error("the day would not read");
      },
    });
    const answered = await call(middleware);

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "That request could not be answered. The dev server's console has the reason.",
    );
    expect(answered.nexted).toBe(false);
  });

  it("answers a handler whose promise rejects", async () => {
    console_();
    const { middleware } = route({
      handle: () => Promise.reject(new Error("the append would not land")),
    });
    const answered = await call(middleware);

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "That request could not be answered. The dev server's console has the reason.",
    );
  });

  it("says nothing about the environment, which is what status withholds", async () => {
    // The backstop is the one catch that does not know which route it caught
    // for. Status's uncaught `porcelain` read arrives here, and its causes
    // quote absolute paths and PATH lookups — the exact thing that route's 500
    // exists to keep out of a response. A backstop that relayed would relay it
    // from underneath the route that decided not to.
    const logged = console_();
    const cause = new Error(
      "spawn git ENOENT: no 'git' on PATH, running in /home/maintainer/rhyme-bee",
    );
    const { middleware } = route({ handle: () => Promise.reject(cause) });
    const answered = await call(middleware);

    expect(answered.status).toBe(500);
    expect(answered.body).not.toContain("PATH");
    expect(answered.body).not.toContain("/home/maintainer");
    expect(answered.body).not.toContain("git");
    // Withheld from the reply, not thrown away: the maintainer reads it whole.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("/api/editor/example"), cause);
  });

  it("leaves a reply that was already sent alone when the handler then throws", async () => {
    const logged = console_();
    const cause = new Error("something after the reply");
    const { middleware } = route({
      handle: (_req, res) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ outcome: "day" }));
        throw cause;
      },
    });
    const answered = await call(middleware);

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toEqual({ outcome: "day" });
    // Nothing can be said on a socket that is already closed, so the console is
    // the only trace this bug leaves — and it is not swallowed.
    expect(logged).toHaveBeenCalledWith(expect.any(String), cause);
  });
});

describe("relaying a cause", () => {
  /** A response that only records, since `relayCause` is called outside a route. */
  function recorder() {
    const wrote: { status: number; body: string } = { status: 0, body: "" };
    const res = {
      set statusCode(value: number) {
        wrote.status = value;
      },
      setHeader() {},
      end(payload?: string) {
        wrote.body = payload ?? "";
      },
    } as unknown as ServerResponse;
    return { res, wrote };
  }

  it("answers 500 with the prefix and the cause, and nothing between them", async () => {
    const { res, wrote } = recorder();
    relayCause(res, "Could not read 2026-08-03", new Error("No built Rhyme Index in /repo."));

    expect(wrote.status).toBe(500);
    expect(JSON.parse(wrote.body)).toEqual({
      error: "Could not read 2026-08-03: No built Rhyme Index in /repo.",
    });
  });

  it("relays a cause that is not an Error at all", async () => {
    const { res, wrote } = recorder();
    relayCause(res, "Could not record that demotion", "the file went away");

    expect(JSON.parse(wrote.body).error).toBe(
      "Could not record that demotion: the file went away",
    );
  });

  it("adds no remedy of its own, which is the whole reason it exists", async () => {
    // The causes already name their file and their remedy. A second sentence
    // guessing at one reads as two diagnoses of a single problem.
    const { res, wrote } = recorder();
    relayCause(res, "Could not add those words", new Error("data/supplement.txt is read-only."));

    expect(JSON.parse(wrote.body).error).toBe(
      "Could not add those words: data/supplement.txt is read-only.",
    );
  });
});

describe("the plugin the spec becomes", () => {
  it("is dev-only, which is what keeps an editor route out of a production build", async () => {
    const plugin = editorRoute(route().spec);

    expect(plugin.apply).toBe("serve");
  });

  it("takes the name its path already had", () => {
    expect(editorRoute(route({ path: "/api/editor/day" }).spec).name).toBe("rhyme-bee-editor-day");
    expect(editorRoute(route({ path: "/api/editor/tier" }).spec).name).toBe(
      "rhyme-bee-editor-tier",
    );
    expect(editorRoute(route({ path: "/api/editor/demotion" }).spec).name).toBe(
      "rhyme-bee-editor-demotion",
    );
  });

  it("mounts one middleware, on the path the spec names", async () => {
    const plugin = editorRoute(route({ path: "/api/editor/example" }).spec);
    const mounted: Array<[string, unknown]> = [];
    const server = {
      middlewares: { use: (path: string, fn: unknown) => mounted.push([path, fn]) },
    };

    // `configureServer` is the hook Vite calls, and only during `npm run dev`.
    await (plugin.configureServer as (s: unknown) => void)(server);

    expect(mounted).toHaveLength(1);
    expect(mounted[0]![0]).toBe("/api/editor/example");
    expect(typeof mounted[0]![1]).toBe("function");
  });

  it("answers through the middleware it mounted", async () => {
    const plugin: Plugin = editorRoute(route({ verbs: ["POST"] }).spec);
    let mounted: ReturnType<typeof editorMiddleware> | undefined;
    const server = {
      middlewares: {
        use: (_path: string, fn: ReturnType<typeof editorMiddleware>) => (mounted = fn),
      },
    };
    await (plugin.configureServer as (s: unknown) => void)(server);

    const answered = await call(mounted!, { method: "POST", body: "hello" });
    expect(JSON.parse(answered.body)).toEqual({ saw: "hello" });
  });
});
