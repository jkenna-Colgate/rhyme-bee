/**
 * The deployed flag endpoint. The interesting decisions live in the pure module
 * and are tested there; what is tested here is the transport around them — that
 * a good report reaches the bucket in the shape the pull-down expects, that a
 * refused one never touches it at all, and that nothing about the environment
 * leaks out in a response.
 */

import { describe, expect, it } from "vitest";
import { parseCandidates } from "../../../src/supplementCandidate.ts";
import { handleFlag } from "../flagRoute.ts";
import type { Env } from "../env.ts";

interface Written {
  key: string;
  value: string;
}

/** A stand-in bucket that records what it was asked to write. */
function bucket(onPut?: () => never) {
  const writes: Written[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response("the game") },
    FLAG_QUEUE: {
      put: async (key: string, value: string) => {
        onPut?.();
        writes.push({ key, value });
        return undefined;
      },
    },
    ISSUE_REPO: "jkenna-Colgate/rhyme-bee",
  } satisfies Env;
  return { env, writes };
}

const report = {
  word: "airburst",
  seedWord: "burst",
  seedRhymeKey: "ER S T",
  reason: "not-a-known-word",
  engineRespelling: null,
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://bramble-bee.jackkenna8.workers.dev/api/supplement-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: payload,
  });
}

describe("the should-have-counted endpoint", () => {
  it("writes one object per flag, keyed by timestamp and word", async () => {
    const { env, writes } = bucket();
    const response = await handleFlag(post(report), env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ word: "airburst" });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toMatch(/^flags\/[\dT-]+Z-airburst\.json$/);
  });

  it("stores the record in the serialisation the judge already reads", async () => {
    const { env, writes } = bucket();
    await handleFlag(post({ ...report, reason: "does-not-rhyme", engineRespelling: "AIR-burst" }), env);

    expect(parseCandidates(writes[0]!.value)).toEqual([
      {
        word: "airburst",
        seedWord: "burst",
        seedRhymeKey: "ER S T",
        reason: "does-not-rhyme",
        engineRespelling: "AIR-burst",
        timestamp: expect.any(String),
      },
    ]);
  });

  it("refuses a report the record shape does not admit, and writes nothing", async () => {
    for (const bad of [
      { ...report, reason: "vibes" },
      { ...report, word: "air burst" },
      { ...report, word: "a".repeat(46) },
      { ...report, surpriseField: true },
    ]) {
      const { env, writes } = bucket();
      const response = await handleFlag(post(bad), env);
      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    }
  });

  it("refuses a body over the cap before reading it, and writes nothing", async () => {
    const { env, writes } = bucket();
    const response = await handleFlag(post({ ...report, word: "a".repeat(4000) }), env);

    expect(response.status).toBe(413);
    expect(writes).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    const { env, writes } = bucket();
    const request = post({ ...report, word: "a".repeat(4000) }, { "Content-Length": "42" });

    expect((await handleFlag(request, env)).status).toBe(413);
    expect(writes).toEqual([]);
  });

  it("refuses a body that is not JSON, and writes nothing", async () => {
    const { env, writes } = bucket();
    expect((await handleFlag(post("{not json"), env)).status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("answers anything but POST with a method refusal", async () => {
    const { env } = bucket();
    const request = new Request("https://example.test/api/supplement-candidate");
    const response = await handleFlag(request, env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("keeps a storage failure to itself — no bucket name, no raw error", async () => {
    const { env } = bucket(() => {
      throw new Error("R2 PUT failed for bucket rhyme-bee-flags: token 0xdeadbeef");
    });
    const response = await handleFlag(post(report), env);

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/rhyme-bee-flags|deadbeef|R2/);
  });
});
