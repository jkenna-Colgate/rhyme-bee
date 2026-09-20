/**
 * The deployed Appeal endpoint. The interesting decisions live in the pure
 * module and are tested there; what is tested here is the transport around
 * them — that a good report reaches the bucket in the shape the pull-down
 * expects, that a refused one never touches it at all, and that nothing about
 * the environment leaks out in a response.
 */

import { describe, expect, it } from "vitest";
import { parseCandidates } from "../../../src/supplementCandidate.ts";
import { handleAppeal } from "../appealRoute.ts";
import type { Env } from "../env.ts";

interface Written {
  key: string;
  value: string;
}

/**
 * A stand-in bucket that records what it was asked to write, and a stand-in
 * limiter that records the keys it was asked about. `allow` of `false` is a
 * caller already over the limit.
 */
function bucket(onPut?: () => never, allow = true) {
  const writes: Written[] = [];
  const limitKeys: string[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response("the game") },
    APPEAL_QUEUE: {
      put: async (key: string, value: string) => {
        onPut?.();
        writes.push({ key, value });
        return undefined;
      },
    },
    APPEAL_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limitKeys.push(key);
        return { success: allow };
      },
    },
    FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
    ISSUE_REPO: "jkenna-Colgate/rhyme-bee",
  } satisfies Env;
  return { env, writes, limitKeys };
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
  return new Request("https://bramble-bee.kenna-dev.workers.dev/api/supplement-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: payload,
  });
}

describe("the should-have-counted endpoint", () => {
  it("writes one object per Appeal, keyed by timestamp and word", async () => {
    const { env, writes } = bucket();
    const response = await handleAppeal(post(report), env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ word: "airburst" });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toMatch(/^flags\/[\dT-]+Z-airburst\.json$/);
  });

  it("stores the record in the serialisation the judge already reads", async () => {
    const { env, writes } = bucket();
    await handleAppeal(post({ ...report, reason: "does-not-rhyme", engineRespelling: "AIR-burst" }), env);

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
      const response = await handleAppeal(post(bad), env);
      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    }
  });

  it("refuses a body over the cap before reading it, and writes nothing", async () => {
    const { env, writes } = bucket();
    const response = await handleAppeal(post({ ...report, word: "a".repeat(4000) }), env);

    expect(response.status).toBe(413);
    expect(writes).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    const { env, writes } = bucket();
    const request = post({ ...report, word: "a".repeat(4000) }, { "Content-Length": "42" });

    expect((await handleAppeal(request, env)).status).toBe(413);
    expect(writes).toEqual([]);
  });

  it("refuses a body that is not JSON, and writes nothing", async () => {
    const { env, writes } = bucket();
    expect((await handleAppeal(post("{not json"), env)).status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("answers anything but POST with a method refusal", async () => {
    const { env } = bucket();
    const request = new Request("https://example.test/api/supplement-candidate");
    const response = await handleAppeal(request, env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("refuses a caller over the limit, without reading the body or writing", async () => {
    const { env, writes } = bucket(undefined, false);
    const request = post(report);
    const response = await handleAppeal(request, env);

    expect(response.status).toBe(429);
    expect(request.bodyUsed).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses over the limit even when the body is one the cap would have caught", async () => {
    // The limit is checked before the body is read, so a flood costs no read:
    // an oversize body from a limited caller is a 429, never a 413.
    const { env } = bucket(undefined, false);
    const response = await handleAppeal(post({ ...report, word: "a".repeat(4000) }), env);

    expect(response.status).toBe(429);
  });

  it("counts the limit against the client IP, and stores it nowhere", async () => {
    const { env, writes, limitKeys } = bucket();
    await handleAppeal(post(report, { "CF-Connecting-IP": "203.0.113.7" }), env);

    expect(limitKeys).toEqual(["203.0.113.7"]);
    expect(JSON.stringify(writes)).not.toContain("203.0.113.7");
  });

  it("keeps a storage failure to itself — no bucket name, no raw error", async () => {
    const { env } = bucket(() => {
      throw new Error("R2 PUT failed for bucket rhyme-bee-flags: token 0xdeadbeef");
    });
    const response = await handleAppeal(post(report), env);

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/rhyme-bee-flags|deadbeef|R2/);
  });
});
