/**
 * The Worker's routing table. The one thing that must never regress is that
 * adding an endpoint cannot take the game down with it: everything but a known
 * path is the game, and goes to the assets untouched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index.ts";
import { SHARE_PATH_PREFIX } from "../../src/share/shareTargets.ts";
import type { Env } from "../env.ts";

function envServing(asset: string, present?: (pathname: string) => boolean) {
  const asked: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        const { pathname } = new URL(request.url);
        asked.push(pathname);
        return present === undefined || present(pathname)
          ? new Response(asset)
          : new Response("not found", { status: 404 });
      },
    },
    APPEAL_QUEUE: { put: async () => undefined },
    ISSUE_REPO: "jkenna-Colgate/rhyme-bee",
    GITHUB_ISSUE_TOKEN: "github_pat_0xdeadbeef",
  } satisfies Env;
  return { env, asked };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = (path: string) => `https://bramble-bee.kenna-dev.workers.dev${path}`;

describe("the deployed Worker", () => {
  it("hands the game itself to the assets, untouched", async () => {
    const { env, asked } = envServing("the game");
    for (const path of ["/", "/index.html", "/index.json", "/assets/main.js"]) {
      const response = await worker.fetch(new Request(url(path)), env);
      await expect(response.text()).resolves.toBe("the game");
    }
    expect(asked).toEqual(["/", "/index.html", "/index.json", "/assets/main.js"]);
  });

  it("routes the appeal path to its own handler instead", async () => {
    const { env, asked } = envServing("the game");
    const response = await worker.fetch(
      new Request(url("/api/supplement-candidate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: "airburst",
          seedWord: "burst",
          seedRhymeKey: "ER S T",
          reason: "not-a-known-word",
          engineRespelling: null,
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(asked).toEqual([]);
  });

  it("routes the feedback path to its own handler instead", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ number: 118, html_url: "https://github.test/issues/118" })),
    );
    const { env, asked } = envServing("the game");
    const response = await worker.fetch(
      new Request(url("/api/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "it rejects real rhymes", context: null }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(asked).toEqual([]);
  });

  /**
   * Share pages are named after the Ranks, and Ranks get renamed. A link that
   * has already been sent cannot be edited, so the day a Rank is renamed every
   * message carrying its URL must still land somewhere that explains the game
   * (#196, #203). The asset that *does* exist is untouched: it never reaches
   * this Worker at all in production, and must not be second-guessed here.
   */
  describe("a share page the build never wrote", () => {
    it("falls through to the game's front page rather than a 404", async () => {
      const { env, asked } = envServing("the game", (pathname) => pathname === "/");
      const response = await worker.fetch(
        new Request(url(`${SHARE_PATH_PREFIX}sonneteer.html`)),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("the game");
      expect(asked).toEqual([`${SHARE_PATH_PREFIX}sonneteer.html`, "/"]);
    });

    it("leaves a share page that does exist alone", async () => {
      const { env, asked } = envServing("a badge page", () => true);
      const response = await worker.fetch(new Request(url(`${SHARE_PATH_PREFIX}beginner.html`)), env);

      await expect(response.text()).resolves.toBe("a badge page");
      expect(asked).toEqual([`${SHARE_PATH_PREFIX}beginner.html`]);
    });

    it("still 404s off the share path, so nothing else is quietly rewritten", async () => {
      const { env, asked } = envServing("the game", () => false);
      const response = await worker.fetch(new Request(url("/rhyme-index-abc123.json")), env);

      expect(response.status).toBe(404);
      expect(asked).toEqual(["/rhyme-index-abc123.json"]);
    });
  });
});
