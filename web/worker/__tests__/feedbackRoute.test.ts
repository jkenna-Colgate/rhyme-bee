/**
 * The deployed general-note endpoint. What a valid note is lives in the pure
 * module and is tested there; what is tested here is the transport around it —
 * that a good note reaches the tracker as an issue the maintainer's triage will
 * see, that a refused one never calls the tracker at all, that an unusable
 * credential is a named failure rather than a mystery, and that nothing about
 * the environment leaks out in a response.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTitle } from "../../src/feedback/feedbackIssue.ts";
import { handleFeedback } from "../feedbackRoute.ts";
import type { Env } from "../env.ts";

const TOKEN = "github_pat_0xdeadbeef";

interface Called {
  url: string;
  headers: Headers;
  body: { title: string; body: string; labels: string[] };
}

/**
 * An env with a stubbed `fetch` standing in for GitHub, recording what it was
 * asked. `reply` is what GitHub says back; a function is thrown instead, which
 * is how an unreachable tracker shows up. `token` of `null` means the secret was
 * never set at all, which is a different state from its being empty.
 */
function tracker(reply: Response | (() => never), token: string | null = TOKEN) {
  const calls: Called[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(init.body as string),
    });
    if (typeof reply === "function") reply();
    return reply;
  });
  const env = {
    ASSETS: { fetch: async () => new Response("the game") },
    APPEAL_QUEUE: { put: async () => undefined },
    ISSUE_REPO: "jkenna-Colgate/rhyme-bee",
    GITHUB_ISSUE_TOKEN: token ?? undefined,
  } satisfies Env;
  return { env, calls };
}

const filed = () =>
  new Response(JSON.stringify({ number: 118, html_url: "https://github.test/issues/118" }), {
    status: 200,
  });

const CONTEXT = {
  seedWord: "ate",
  score: 42,
  rank: "Troubadour",
  foundAnswers: 7,
  totalAnswers: 30,
  foundBonus: 2,
  url: "https://bramble-bee.kenna-dev.workers.dev/",
  timestamp: "2026-08-05T10:00:00.000Z",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://bramble-bee.kenna-dev.workers.dev/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: payload,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the general-note endpoint", () => {
  it("files the note as an issue and answers with its number and URL", async () => {
    const { env, calls } = tracker(filed());
    const response = await handleFeedback(post({ text: "it rejects real rhymes", context: CONTEXT }), env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      number: 118,
      url: "https://github.test/issues/118",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/jkenna-Colgate/rhyme-bee/issues");
    expect(calls[0]!.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(calls[0]!.headers.get("User-Agent")).toBeTruthy();
    expect(calls[0]!.body.labels).toEqual(["feedback"]);
  });

  it("stamps the session context into the body the existing builder makes", async () => {
    const { env, calls } = tracker(filed());
    await handleFeedback(post({ text: "it rejects real rhymes", context: CONTEXT }), env);

    expect(calls[0]!.body.body).toContain("it rejects real rhymes");
    expect(calls[0]!.body.body).toContain("**Seed Word:** ate");
    expect(calls[0]!.body.body).toContain("**Answers:** 7/30");
  });

  it("titles the issue with the derived fallback, having no titler to ask", async () => {
    const { env, calls } = tracker(filed());
    const text = "the reveal ended my session without asking\nand I lost the rank";
    await handleFeedback(post({ text, context: null }), env);

    expect(calls[0]!.body.title).toBe(deriveTitle(text));
    expect(calls[0]!.body.title).toBe("the reveal ended my session without asking");
  });

  it("refuses a note the pure module does not admit, and files nothing", async () => {
    for (const bad of [
      { text: "" },
      { text: "a note", title: "a title I chose myself" },
      { text: "a note", context: { ...CONTEXT, score: "lots" } },
      { notATextField: true },
    ]) {
      const { env, calls } = tracker(filed());
      const response = await handleFeedback(post(bad), env);
      expect(response.status).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  it("refuses a body over the cap before reading it, and files nothing", async () => {
    const { env, calls } = tracker(filed());
    const response = await handleFeedback(post({ text: "x".repeat(9000) }), env);

    expect(response.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    const { env, calls } = tracker(filed());
    const request = post({ text: "x".repeat(9000) }, { "Content-Length": "42" });

    expect((await handleFeedback(request, env)).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("refuses a body that is not JSON, and files nothing", async () => {
    const { env, calls } = tracker(filed());
    expect((await handleFeedback(post("{not json"), env)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers anything but POST with a method refusal", async () => {
    const { env } = tracker(filed());
    const response = await handleFeedback(
      new Request("https://example.test/api/feedback"),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("names an unset credential rather than calling the tracker without one", async () => {
    // `wrangler secret put` with stdin closed uploads an empty string and
    // reports success (#114) — both states must say what is wrong.
    for (const token of [null, "", "   "]) {
      const { env, calls } = tracker(filed(), token);
      const response = await handleFeedback(post({ text: "a note" }), env);

      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).toMatch(/not configured/i);
      expect(calls).toEqual([]);
    }
  });

  it("distinguishes a credential the tracker rejected from a general failure", async () => {
    const cases: [number, RegExp][] = [
      [401, /401/],
      [403, /403/],
      [404, /404/],
      [422, /422/],
      [500, /500/],
    ];
    for (const [status, expected] of cases) {
      const { env } = tracker(new Response("{}", { status }));
      const response = await handleFeedback(post({ text: "a note" }), env);

      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).toMatch(expected);
    }
  });

  it("keeps an unreachable tracker to itself — no token, no raw error", async () => {
    const { env } = tracker(() => {
      throw new Error(`POST https://api.github.com failed: Authorization: Bearer ${TOKEN}`);
    });
    const response = await handleFeedback(post({ text: "a note" }), env);

    expect(response.status).toBe(502);
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/deadbeef|Bearer|github_pat/);
  });

  it("never puts the credential or the repository into a reply it did file", async () => {
    const { env } = tracker(filed());
    const response = await handleFeedback(post({ text: "a note" }), env);

    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/deadbeef|github_pat|jkenna-Colgate/);
  });

  it("does not pretend a reply it cannot read is a filed issue", async () => {
    const { env } = tracker(new Response(JSON.stringify({ message: "ok" }), { status: 201 }));
    const response = await handleFeedback(post({ text: "a note" }), env);

    expect(response.status).toBe(502);
  });
});
