/**
 * The Worker's routing table. The one thing that must never regress is that
 * adding an endpoint cannot take the game down with it: everything but a known
 * path is the game, and goes to the assets untouched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index.ts";
import type { Env } from "../env.ts";

function envServing(asset: string) {
  const asked: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        asked.push(new URL(request.url).pathname);
        return new Response(asset);
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
});
