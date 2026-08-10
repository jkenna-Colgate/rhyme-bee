/**
 * The dev-only supplement-candidate endpoint — the transport around a record
 * whose meaning, validation and serialisation are `src/supplementCandidate.ts`
 * and are tested there.
 *
 * It is the last route on the dev server to get one, and it was declined for a
 * reason that has now been removed: the queue was a module constant pointing at
 * `data/supplement-candidates.jsonl`, so driving the handler appended to the
 * maintainer's own queue. `supplementHandler` takes its append, so every case
 * here appends to an array and nothing touches `data/`.
 *
 * What is worth pinning is what the two callers now depend on. One is the
 * game's should-have-counted button and one is the Editor's Pass (#163), they
 * post the same five fields, and this endpoint cannot tell them apart — so the
 * claims under test are that a valid report lands *one* line and echoes the
 * word, that every refusal lands *none*, and that the timestamp is the
 * endpoint's rather than the sender's. The last is the one a caller could
 * quietly break: the wire carries five fields and the record six, and a report
 * arriving with its own timestamp has to be refused rather than trusted.
 *
 * `web/__tests__/editorDemotionEndpoint.test.ts` is the shape these follow, and
 * `AGENTS.md` records why transport is tested here at all.
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { supplementHandler } from "../supplementPlugin.ts";

interface Answered {
  status: number;
  body: string;
  nexted: boolean;
}

/** Call the handler the way connect does, mounted prefix already stripped. */
async function call(
  handler: ReturnType<typeof supplementHandler>,
  options: { method?: string; body?: string } = {},
): Promise<Answered> {
  const body = options.body ?? "";
  const req = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as IncomingMessage;
  req.method = options.method ?? "GET";
  req.url = "/";
  req.headers = {};

  const answered: Answered = { status: 0, body: "", nexted: false };
  let finish: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const res = {
    set statusCode(value: number) {
      answered.status = value;
    },
    get statusCode() {
      return answered.status;
    },
    setHeader() {},
    end(payload?: string) {
      answered.body = payload ?? "";
      finish();
    },
  } as unknown as ServerResponse;

  handler(req, res, () => {
    answered.nexted = true;
    finish();
  });
  await done;
  return answered;
}

/** The endpoint with the queue replaced by an array, so nothing touches `data/`. */
function endpoint(options: { append?: (line: string) => Promise<void> } = {}) {
  const queued: string[] = [];
  const handler = supplementHandler({
    append:
      options.append ??
      (async (line) => {
        queued.push(line);
      }),
  });
  return { handler, queued };
}

/** A report of the shape both callers post: five fields, no timestamp. */
const REPORT = {
  word: "bluebeard",
  seedWord: "beard",
  seedRhymeKey: "IH R D",
  reason: "does-not-rhyme",
  engineRespelling: "BLOO-berd",
};

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("the verbs it answers", () => {
  /**
   * A non-`POST` falls through rather than answering 405 — unlike the four
   * editor routes and unlike this endpoint's own deployed half, which refuses
   * the verb. Pinned as it stands rather than corrected: the divergence is real
   * and worth being on the record, and changing a dev route's answer to a verb
   * nothing sends belongs to a decision rather than to a findings commit.
   */
  it("falls through on GET rather than answering, and writes nothing", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, { method: "GET" });

    expect(answered.nexted).toBe(true);
    expect(answered.status).toBe(0);
    expect(queued).toEqual([]);
  });

  it("falls through on DELETE too", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, { method: "DELETE", body: JSON.stringify(REPORT) });

    expect(answered.nexted).toBe(true);
    expect(queued).toEqual([]);
  });
});

describe("a report the endpoint accepts", () => {
  it("appends exactly one line and echoes the word back", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, post(REPORT));

    expect(answered.status).toBe(201);
    expect(JSON.parse(answered.body)).toEqual({ word: REPORT.word });
    expect(queued).toHaveLength(1);
  });

  it("queues one JSON Lines record, ending in a newline", async () => {
    const { handler, queued } = endpoint();
    await call(handler, post(REPORT));

    expect(queued[0]!.endsWith("\n")).toBe(true);
    expect(queued[0]!.trimEnd()).not.toContain("\n");
    expect(JSON.parse(queued[0]!)).toMatchObject(REPORT);
  });

  /**
   * The timestamp is the endpoint's, taken from the clock here rather than from
   * the sender — which is what stops anything on the far end of a socket from
   * scattering records across the queue's ordering. The report carries five
   * fields and the record six, and this is the sixth.
   */
  it("stamps the record with an instant the sender did not choose", async () => {
    const { handler, queued } = endpoint();
    const before = Date.now();
    await call(handler, post(REPORT));

    const stamped = JSON.parse(queued[0]!) as { timestamp: string };
    expect(Date.parse(stamped.timestamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(stamped.timestamp)).toBeLessThanOrEqual(Date.now());
  });
});

describe("what it refuses, and writes nothing for", () => {
  it("refuses a body that is not JSON at all", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, { method: "POST", body: "not json" });

    expect(answered.status).toBe(500);
    expect(queued).toEqual([]);
  });

  /**
   * The Seed Word, not the respelling. `engineRespelling` is the one field of
   * the five the validator will supply for itself — absent, it records `null`,
   * which is the case a word with no reading at all produces — so dropping it
   * tests nothing. Dropping the Seed Word tests the refusal, and the Seed Word
   * is the field the judge cannot rule without.
   */
  it("refuses a report missing a field the record needs", async () => {
    const { handler, queued } = endpoint();
    const { seedWord: _dropped, ...short } = REPORT;
    const answered = await call(handler, post(short));

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toEqual(expect.any(String));
    expect(queued).toEqual([]);
  });

  /**
   * A report is refused *whole* when it carries a field the record does not
   * recognise, rather than having the extra trimmed off. That is the rule the
   * browser's `DisagreementReport` is written out by hand to keep in step with,
   * and the reason the recorder can tell the editor "nothing was written" on
   * any refusal at all.
   */
  it("refuses a report carrying a sixth field rather than trimming it", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, post({ ...REPORT, timestamp: "2026-08-09T00:00:00.000Z" }));

    expect(answered.status).toBe(400);
    expect(queued).toEqual([]);
  });

  it("refuses a word the validator does not take", async () => {
    const { handler, queued } = endpoint();
    const answered = await call(handler, post({ ...REPORT, word: "blue beard" }));

    expect(answered.status).toBe(400);
    expect(queued).toEqual([]);
  });

  /**
   * A queue that would not take the append is answered rather than left hanging
   * — the caller's whole reason for clicking is that the observation survives,
   * so a write that failed has to say so. The cause is relayed because the
   * reader on this route is the maintainer and the paths in it are their own.
   */
  it("answers 500 when the append fails, and does not claim the word landed", async () => {
    const { handler } = endpoint({
      append: () => Promise.reject(new Error("EACCES: data/supplement-candidates.jsonl")),
    });
    const answered = await call(handler, post(REPORT));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("EACCES");
  });
});
