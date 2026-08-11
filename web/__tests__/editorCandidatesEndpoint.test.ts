/**
 * The dev-only endpoint the Editor's Pass reads the Candidate Queue through.
 * What the queue *is* is `scripts/editorCandidates.ts` and is tested there; what
 * is tested here is the transport around it — that the whole readout reaches the
 * browser with its states already resolved, and that the route decides nothing
 * of its own.
 *
 * The socket ceremony this route shares with the other five — the body cap, and
 * that no path falls through — is `web/editorRoute.ts`'s and is tested in
 * `editorRoute.test.ts`. What stays here is this route's own 405 *sentence*,
 * which is not shared and says what this route is for, and the cap it hands the
 * skeleton, which is this route's own number.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost; this follows the
 * shape `editorDayEndpoint.test.ts` took.
 */

import { describe, expect, it } from "vitest";
import { makeTestData } from "../../src/__fixtures__/index.ts";
import type { Decline } from "../../src/declines.ts";
import type { Schedule } from "../../src/schedule.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import { evidenceContextFrom, type EvidenceContext } from "../../src/supplementEvidence.ts";
import { editorCandidatesSpec } from "../editorCandidatesPlugin.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";

const DOCKED = "AA K T";

const SCHEDULE: Schedule = {
  startDate: "2026-09-01",
  band: { min: 1, max: 500 },
  days: [
    {
      date: "2026-09-02",
      weekday: "Wed",
      week: 1,
      seed: "shellshocked",
      rhymeKey: DOCKED,
      answerCount: 9,
      difficulty: 0.4,
    },
  ],
};

function jot(word: string, seedWord: string, timestamp: string): SupplementCandidate {
  return {
    word,
    seedWord,
    seedRhymeKey: DOCKED,
    reason: "does-not-rhyme",
    engineRespelling: null,
    timestamp,
  };
}

const QUEUE: SupplementCandidate[] = [
  jot("talked", "docked", "2026-08-01T12:00:00.000Z"),
  jot("undocked", "shellshocked", "2026-08-07T18:30:00.000Z"),
];

/** The fixture's pinned inputs, which is where the cot–caught merger lives. */
function context(): EvidenceContext {
  const raw = makeTestData();
  return evidenceContextFrom({
    pronunciations: raw.pronunciations,
    words: raw.words,
    names: raw.names,
  });
}

/**
 * The endpoint with everything it depends on stubbed and nothing loaded, driven
 * through the shared skeleton so that what is tested is the route as mounted —
 * its own 405 sentence included. `read` records which deps were reached, which
 * is how a refusal is shown to have done nothing.
 */
function endpoint(overrides: Partial<Parameters<typeof editorCandidatesSpec>[0]> = {}) {
  const read: string[] = [];
  const handler = editorMiddleware(
    editorCandidatesSpec({
      queue: () => {
        read.push("queue");
        return QUEUE;
      },
      schedule: () => SCHEDULE,
      declines: () => [] as Decline[],
      context: () => {
        read.push("context");
        return context();
      },
      ...overrides,
    }),
  );
  return { handler, read };
}

describe("the dev-only Candidate Queue endpoint", () => {
  it("answers a read with the whole readout, states already resolved", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/" });

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(answered.body)).toMatchObject({
      total: 2,
      outstanding: 1,
      newest: "2026-08-07T18:30:00.000Z",
      groups: [
        {
          rhymeKey: DOCKED,
          day: { date: "2026-09-02", weekday: "Wed", week: 1, seed: "shellshocked" },
          seedWords: ["docked", "shellshocked"],
          outstanding: 1,
          candidates: [
            { word: "talked", state: "resolved" },
            { word: "undocked", state: "addable" },
          ],
        },
      ],
    });
  });

  it("answers an empty queue rather than treating it as a failure", async () => {
    const { handler } = endpoint({ queue: () => [] });
    const answered = await call(handler, { url: "/" });

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toEqual({
      groups: [],
      total: 0,
      outstanding: 0,
      newest: null,
    });
  });

  it("carries a standing Decline through without deciding anything about it", async () => {
    const { handler } = endpoint({
      declines: () => [{ word: "undocked", rhymeKey: DOCKED }],
    });
    const answered = await call(handler, { url: "/" });

    const body = JSON.parse(answered.body) as { outstanding: number; groups: { candidates: { word: string; state: string }[] }[] };
    expect(body.groups[0]!.candidates.map((c) => [c.word, c.state])).toEqual([
      ["talked", "resolved"],
      ["undocked", "declined"],
    ]);
    expect(body.outstanding).toBe(0);
  });

  // The mechanism is `web/editorRoute.ts`'s and is tested there. The sentence
  // is this route's own, and says what the route is *for* rather than what it
  // refused — so it is asserted here, where changing it would be noticed.
  it("answers anything but GET with this route's own refusal, reading nothing", async () => {
    const { handler, read } = endpoint();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, { method, url: "/" });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET");
      expect(JSON.parse(answered.body)).toEqual({
        error: "Read the Candidate Queue with GET. Nothing on it is written from here.",
      });
      expect(answered.nexted).toBe(false);
    }
    expect(read).toEqual([]);
  });

  // The cap is the route's own number, enforced by the shared skeleton. A `GET`
  // carries no body, so a body arriving at all is already a request nobody
  // meant — and it is refused before the pinned sources are opened.
  it("refuses a body over the cap without reading the queue", async () => {
    const { handler, read } = endpoint();
    const answered = await call(handler, {
      url: "/",
      body: "x".repeat(1024),
      headers: { "content-length": "1024" },
    });

    expect(answered.status).toBe(413);
    expect(answered.nexted).toBe(false);
    expect(read).toEqual([]);
  });

  it("relays a missing pinned source, remedy and all", async () => {
    const { handler } = endpoint({
      context: () => {
        throw new Error("ENOENT: no such file or directory, open '/repo/data/cmudict.dict'");
      },
    });
    const answered = await call(handler, { url: "/" });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "Could not read the Candidate Queue: ENOENT: no such file or directory, " +
        "open '/repo/data/cmudict.dict'",
    );
  });

  it("relays an unreadable schedule artifact", async () => {
    const { handler } = endpoint({
      schedule: () => {
        throw new Error("/repo/data/schedule.json is not a readable schedule artifact.");
      },
    });
    const answered = await call(handler, { url: "/" });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "Could not read the Candidate Queue: /repo/data/schedule.json is not a readable schedule artifact.",
    );
  });
});
