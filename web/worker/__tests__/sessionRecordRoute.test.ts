/**
 * The Session Record endpoint (ADR-0019). What a valid record is lives in the
 * pure `src/sessionRecord.ts` and is tested there; what is tested here is the
 * transport: method handling, the limiter, the body cap and the refusal path,
 * that a resend overwrites, and that the client IP goes to the limiter and
 * nowhere else.
 */

import { describe, expect, it } from "vitest";
import { MAX_RECORD_BYTES, parseSessionRecord } from "../../../src/sessionRecord.ts";
import { SESSION_RECORD_PATH } from "../../src/endpoints.ts";
import worker from "../index.ts";
import { handleSessionRecord } from "../sessionRecordRoute.ts";
import type { Env } from "../env.ts";

function harness(options: { allow?: boolean; failPut?: boolean } = {}) {
  const objects = new Map<string, string>();
  const puts: string[] = [];
  const limitKeys: string[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response("the game") },
    APPEAL_QUEUE: {
      put: async (key: string, value: string) => {
        if (options.failPut) throw new Error("R2 at account 0123abcd said no");
        puts.push(key);
        objects.set(key, value);
        return undefined;
      },
    },
    APPEAL_LIMITER: { limit: async () => ({ success: true }) },
    FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
    SESSION_RECORD_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limitKeys.push(key);
        return { success: options.allow ?? true };
      },
    },
    ISSUE_REPO: "jkenna-Colgate/rhyme-bee",
  } satisfies Env;
  return { env, objects, puts, limitKeys };
}

const ID = "fedcba9876543210fedcba9876543210";

const record = {
  id: ID,
  date: "2026-10-29",
  seed: { word: "cup", rhymeKey: "AH P" },
  submissions: ["pup", "makeup"],
  ended: false,
  indexHash: "6097632138aad59e",
};

function request(body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://bramble-bee.kenna-dev.workers.dev${SESSION_RECORD_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

describe("the Session Record endpoint", () => {
  it("writes one record under its date and id", async () => {
    const { env, objects } = harness();
    const response = await handleSessionRecord(request(record), env);

    expect(response.status).toBe(201);
    expect([...objects.keys()]).toEqual([`sessions/2026-10-29/${ID}.json`]);
    expect(parseSessionRecord(objects.get(`sessions/2026-10-29/${ID}.json`)!)).toEqual(record);
  });

  it("replaces the earlier copy when the same Session is sent again, grown", async () => {
    const { env, objects } = harness();
    await handleSessionRecord(request(record), env);
    const grown = { ...record, submissions: [...record.submissions, "up"], ended: true };
    await handleSessionRecord(request(grown), env);

    expect(objects.size).toBe(1);
    expect(parseSessionRecord([...objects.values()][0]!)).toEqual(grown);
  });

  it("stores no IP address: the client IP goes to the limiter and nowhere else", async () => {
    const { env, objects, limitKeys } = harness();
    await handleSessionRecord(request(record), env);

    expect(limitKeys).toEqual(["203.0.113.9"]);
    for (const [key, value] of objects) {
      expect(key).not.toContain("203.0.113.9");
      expect(value).not.toContain("203.0.113.9");
    }
  });

  it("is routed at its path by the Worker", async () => {
    const { env, objects } = harness();
    const response = await worker.fetch(request(record), env);
    expect(response.status).toBe(201);
    expect(objects.size).toBe(1);
  });

  it("refuses anything but POST and writes nothing", async () => {
    const { env, puts } = harness();
    const response = await handleSessionRecord(
      new Request(`https://bramble-bee.kenna-dev.workers.dev${SESSION_RECORD_PATH}`),
      env,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(puts).toEqual([]);
  });

  it("refuses a caller over its rate limit before reading the body", async () => {
    const { env, puts } = harness({ allow: false });
    const response = await handleSessionRecord(request(record), env);
    expect(response.status).toBe(429);
    expect(puts).toEqual([]);
  });

  it("refuses a body over the cap", async () => {
    const { env, puts } = harness();
    const padded = JSON.stringify(record) + " ".repeat(MAX_RECORD_BYTES);
    const response = await handleSessionRecord(request(padded), env);
    expect(response.status).toBe(413);
    expect(puts).toEqual([]);
  });

  it("refuses a body that is not JSON", async () => {
    const { env, puts } = harness();
    const response = await handleSessionRecord(request("{not json"), env);
    expect(response.status).toBe(400);
    expect(puts).toEqual([]);
  });

  it("refuses a record that fails validation, and never touches the bucket", async () => {
    const { env, puts } = harness();
    for (const bad of [
      { ...record, id: "../flags/x" },
      { ...record, submissions: ["pup", "https://example.com"] },
      { ...record, browser: "abc" },
    ]) {
      const response = await handleSessionRecord(request(bad), env);
      expect(response.status).toBe(400);
    }
    expect(puts).toEqual([]);
  });

  it("answers a storage failure without saying anything about the bucket", async () => {
    const { env } = harness({ failPut: true });
    const response = await handleSessionRecord(request(record), env);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("0123abcd");
  });
});
