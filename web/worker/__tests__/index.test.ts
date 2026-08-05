/**
 * The Worker's routing table. The one thing that must never regress is that
 * adding an endpoint cannot take the game down with it: everything but a known
 * path is the game, and goes to the assets untouched.
 */

import { describe, expect, it } from "vitest";
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
    FLAG_QUEUE: { put: async () => undefined },
  } satisfies Env;
  return { env, asked };
}

const url = (path: string) => `https://bramble-bee.jackkenna8.workers.dev${path}`;

describe("the deployed Worker", () => {
  it("hands the game itself to the assets, untouched", async () => {
    const { env, asked } = envServing("the game");
    for (const path of ["/", "/index.html", "/index.json", "/assets/main.js"]) {
      const response = await worker.fetch(new Request(url(path)), env);
      await expect(response.text()).resolves.toBe("the game");
    }
    expect(asked).toEqual(["/", "/index.html", "/index.json", "/assets/main.js"]);
  });

  it("routes the flag path to its own handler instead", async () => {
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
});
