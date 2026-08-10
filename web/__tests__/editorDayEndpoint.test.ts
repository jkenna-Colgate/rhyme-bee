/**
 * The dev-only endpoint the Editor's Pass reads a day through. What a day *is*
 * is `scripts/editorDay.ts` and is tested there; what is tested here is the
 * transport around it — that a malformed date is named as one, and that the
 * three cases of the readout reach the browser unaltered.
 *
 * The socket ceremony this route shares with the other four — the body cap, and
 * that no path falls through — is `web/editorRoute.ts`'s and is tested in
 * `editorRoute.test.ts`. What stays here is this route's own 405 *sentence*,
 * which is not shared and says what this route is for.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost;
 * `web/worker/__tests__/feedbackRoute.test.ts` is the shape those tests took and
 * the shape these follow.
 */

import { describe, expect, it } from "vitest";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import type { Schedule } from "../../src/schedule.ts";
import { editorDayRequest } from "../editorDayRequest.ts";
import { editorDaySpec } from "../editorDayPlugin.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";

// --- the schedule and index the endpoint answers over --------------------------

const SCHEDULE: Schedule = {
  startDate: "2026-08-03",
  band: { min: 20, max: 120 },
  days: [
    {
      date: "2026-08-03",
      weekday: "Mon",
      week: 1,
      seed: "ate",
      rhymeKey: "EY T",
      answerCount: 2,
      difficulty: 0.5,
    },
    {
      date: "2026-08-04",
      weekday: "Tue",
      week: 1,
      seed: "unpinnable",
      rhymeKey: "AH B AH L",
      answerCount: 2,
      difficulty: 0.5,
    },
  ],
};

/**
 * Enough of a `RhymeIndex` for the endpoint: one Seed it can pin and one it
 * cannot. Typed through `unknown` because the endpoint reaches for exactly the
 * three members `readScheduledDay` uses, and standing up a real index here would
 * test `buildPuzzle` rather than the transport.
 */
function stubIndex(): RhymeIndex {
  return {
    pinSeed(word: string, rhymeKey?: string) {
      if (word === "unpinnable") throw new Error(`No reading of "unpinnable" is ${rhymeKey}.`);
      return { word, rhymeKey: rhymeKey ?? "EY T" };
    },
    buildPuzzle() {
      return {
        seedRespelling: "AYT",
        answers: [
          { word: "eight", length: 5, knownness: 0.9 },
          { word: "sedate", length: 6, knownness: 0.2 },
        ],
        bonusWords: [{ word: "objurgate", length: 9, knownness: 0.01 }],
      };
    },
    rhymeKeysOf: (word: string) => (word === "unpinnable" ? ["AH N P IH N"] : []),
  } as unknown as RhymeIndex;
}

/**
 * The endpoint with everything it depends on stubbed and nothing loaded, driven
 * through the shared skeleton so that what is tested is the route as mounted —
 * its own 405 sentence included.
 */
function endpoint(overrides: Partial<Parameters<typeof editorDaySpec>[0]> = {}) {
  const opened: string[] = [];
  const handler = editorMiddleware(
    editorDaySpec({
      schedule: () => SCHEDULE,
      openIndex: () => {
        opened.push("opened");
        return stubIndex();
      },
      today: () => "2026-08-02",
      ...overrides,
    }),
  );
  return { handler, opened };
}

describe("the dev-only day endpoint", () => {
  it("answers a read with the day the schedule holds", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/?date=2026-08-03" });

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(answered.body)).toMatchObject({
      outcome: "day",
      date: "2026-08-03",
      seed: "ate",
      seedRespelling: "AYT",
      rhymeKey: "EY T",
      answers: [
        { word: "eight", length: 5, knownness: 0.9 },
        { word: "sedate", length: 6, knownness: 0.2 },
      ],
      bonusWords: [{ word: "objurgate", length: 9, knownness: 0.01 }],
    });
  });

  it("opens on tomorrow when no date is named", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/" });

    expect(JSON.parse(answered.body)).toMatchObject({ outcome: "day", date: "2026-08-03" });
  });

  it("names the run's edges for a date outside it, without opening the index", async () => {
    const { handler, opened } = endpoint();
    const answered = await call(handler, { url: "/?date=2027-01-01" });

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toEqual({
      outcome: "not-scheduled",
      date: "2027-01-01",
      firstDate: "2026-08-03",
      lastDate: "2026-08-04",
    });
    expect(opened).toEqual([]);
  });

  it("renders the schedule/index disagreement rather than failing the request", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/?date=2026-08-04" });

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toMatchObject({
      outcome: "unpinnable",
      seed: "unpinnable",
      scheduledRhymeKey: "AH B AH L",
      indexRhymeKeys: ["AH N P IH N"],
    });
  });

  // The mechanism is `web/editorRoute.ts`'s and is tested there. The sentence
  // is this route's own, and says what the route is *for* rather than what it
  // refused — so it is asserted here, where changing it would be noticed.
  it("answers anything but GET with this route's own refusal, reading nothing", async () => {
    const { handler, opened } = endpoint();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, { method, url: "/?date=2026-08-03" });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET");
      expect(JSON.parse(answered.body)).toEqual({ error: "Read a day with GET." });
      expect(answered.nexted).toBe(false);
    }
    expect(opened).toEqual([]);
  });

  it("names a malformed date rather than reading a day for it", async () => {
    const { handler, opened } = endpoint();
    for (const date of ["tomorrow", "2026-8-3", "2026/08/03", "03-08-2026"]) {
      const answered = await call(handler, { url: `/?date=${encodeURIComponent(date)}` });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toMatch(/YYYY-MM-DD/);
    }
    expect(opened).toEqual([]);
  });

  // The two things that can throw past `readScheduledDay` are a missing index
  // and an unreadable schedule, and both already name their file and their
  // remedy. The endpoint relays that whole and adds nothing, so the editor gets
  // one diagnosis rather than two guesses at one.
  it("relays a missing built index, remedy and all", async () => {
    const { handler } = endpoint({
      openIndex: () => {
        throw new Error(
          "No built Rhyme Index in /repo/dist-data. Run `npm run build:index` from the repo root.",
        );
      },
    });
    const answered = await call(handler, { url: "/?date=2026-08-03" });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "Could not read 2026-08-03: No built Rhyme Index in /repo/dist-data. " +
        "Run `npm run build:index` from the repo root.",
    );
  });

  it("relays an unreadable schedule artifact", async () => {
    const { handler } = endpoint({
      schedule: () => {
        throw new Error("/repo/data/schedule.json is not a readable schedule artifact.");
      },
    });
    const answered = await call(handler, { url: "/?date=2026-08-03" });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toBe(
      "Could not read 2026-08-03: /repo/data/schedule.json is not a readable schedule artifact.",
    );
  });
});

describe("which day a request asks for", () => {
  it("defaults to tomorrow, which is the day most likely to need reviewing", () => {
    expect(editorDayRequest("/", "2026-08-02")).toEqual({ ok: true, date: "2026-08-03" });
    // Month and year ends are the two the arithmetic gets wrong.
    expect(editorDayRequest("/", "2026-08-31")).toEqual({ ok: true, date: "2026-09-01" });
    expect(editorDayRequest("/", "2026-12-31")).toEqual({ ok: true, date: "2027-01-01" });
    expect(editorDayRequest("/", "2028-02-28")).toEqual({ ok: true, date: "2028-02-29" });
  });

  it("takes the named date, however the mount rewrote the URL", () => {
    for (const url of ["/?date=2026-08-20", "/api/editor/day?date=2026-08-20"]) {
      expect(editorDayRequest(url, "2026-08-02")).toEqual({ ok: true, date: "2026-08-20" });
    }
  });

  it("treats an empty date as none named, which is what a cleared field sends", () => {
    expect(editorDayRequest("/?date=", "2026-08-02")).toEqual({ ok: true, date: "2026-08-03" });
  });

  it("refuses anything that is not an ISO date", () => {
    for (const date of ["tomorrow", "2026-8-3", "2026/08/03", "2026-08-03T00:00:00Z"]) {
      const request = editorDayRequest(`/?date=${encodeURIComponent(date)}`, "2026-08-02");
      expect(request.ok).toBe(false);
    }
  });
});
