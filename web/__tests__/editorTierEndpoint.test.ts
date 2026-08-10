/**
 * The dev-only endpoint the Editor's Pass sets a word's Tier through. What a
 * verdict *means* is `src/tierOverride.ts` and what a re-tiered day looks like is
 * `web/__tests__/retier.test.ts`; what is tested here is the transport around
 * them — that every refusal writes nothing, and that a judgement that is
 * accepted reaches the file with the prevalence measured at that moment beside
 * it.
 *
 * The socket ceremony this route shares with the other four — the verb check,
 * the body cap, and that no path falls through — is `web/editorRoute.ts`'s and
 * is tested in `editorRoute.test.ts`. What stays here is this route's own 405
 * *sentence*, and every claim about what a refusal does to
 * `data/tier-overrides.csv`.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost;
 * `web/__tests__/editorDayEndpoint.test.ts` is the shape those tests took and
 * the shape these follow.
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import type { Schedule } from "../../src/schedule.ts";
import type { TierOverrideRow } from "../../src/tierOverride.ts";
import { MAX_TIER_BODY_BYTES, tierWriteRequest } from "../editorTierRequest.ts";
import { editorTierSpec } from "../editorTierPlugin.ts";
import { editorMiddleware } from "../editorRoute.ts";

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
  ],
};

/**
 * Enough of a `RhymeIndex` for the endpoint: a day it can build, a lemma walk,
 * and a vocabulary to compute a judgement's reach over. Typed through `unknown`
 * for the reason the day endpoint's stub is — standing up a real index here
 * would test `buildPuzzle` rather than the transport.
 */
function stubIndex(): RhymeIndex {
  return {
    pinSeed: (word: string, rhymeKey?: string) => ({ word, rhymeKey: rhymeKey ?? "EY T" }),
    buildPuzzle: () => ({
      seedRespelling: "AYT",
      answers: [
        { word: "eight", length: 5, knownness: 0.9 },
        { word: "sedate", length: 6, knownness: 0.2 },
      ],
      bonusWords: [{ word: "objurgate", length: 9, knownness: 0.01 }],
    }),
    rhymeKeysOf: () => [],
    derivation: {
      lemmaCandidates: (word: string) =>
        word.endsWith("s") ? [word, word.slice(0, -1)] : [word],
    },
    *wordhoodEntries() {
      for (const word of ["eight", "sedate", "objurgate", "sedates"]) yield [word, []] as const;
    },
  } as unknown as RhymeIndex;
}

interface Answered {
  status: number;
  headers: Record<string, string>;
  body: string;
  nexted: boolean;
}

/** Call the route the way connect does, mounted prefix already stripped. */
async function call(
  handler: ReturnType<typeof editorMiddleware>,
  options: {
    method?: string;
    url?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Answered> {
  const body = options.body ?? "";
  const req = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as IncomingMessage;
  req.method = options.method ?? "GET";
  req.url = options.url ?? "/";
  req.headers = options.headers ?? {};

  const answered: Answered = { status: 0, headers: {}, body: "", nexted: false };
  let finish: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const res = {
    set statusCode(value: number) {
      answered.status = value;
    },
    get statusCode() {
      return answered.status;
    },
    setHeader(name: string, value: string) {
      answered.headers[name] = value;
    },
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

/** The endpoint with the file replaced by an array, so nothing touches `data/`. */
function endpoint(overrides: Partial<Parameters<typeof editorTierSpec>[0]> = {}) {
  const written: TierOverrideRow[] = [];
  let text = "";
  const handler = editorMiddleware(
    editorTierSpec({
      schedule: () => SCHEDULE,
      openIndex: () => stubIndex(),
      today: () => "2026-08-02",
      measured: () => new Map([["sedate", 0.2], ["eight", 0.9]]),
      overrides: () => text,
      append: (row) => {
        written.push(row);
        text += `${row.word},${row.verdict},${row.measured ?? ""},${row.decided},${row.note}\n`;
      },
      now: () => "2026-08-08T12:00:00.000Z",
      knownnessThreshold: () => 0,
      ...overrides,
    }),
  );
  return { handler, written };
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("reading the picker's state for a day", () => {
  it("answers with the day's lemma walk, its measured values and the standing verdicts", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/?date=2026-08-03" });

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(answered.body)).toMatchObject({
      date: "2026-08-03",
      standing: [],
      lookups: [
        { word: "eight", candidates: ["eight"] },
        { word: "sedate", candidates: ["sedate"] },
        { word: "objurgate", candidates: ["objurgate"] },
      ],
      measured: { eight: 0.9, sedate: 0.2 },
      knownnessThreshold: 0,
    });
  });

  it("opens on tomorrow when no date is named, as the day endpoint does", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/" });

    expect(JSON.parse(answered.body).date).toBe("2026-08-03");
  });

  it("answers a date outside the run with the standing verdicts and no lists", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, { url: "/?date=2027-01-01" });

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toMatchObject({ date: "2027-01-01", lookups: [] });
  });

  it("names a malformed date rather than reading anything for it", async () => {
    const { handler } = endpoint();
    for (const date of ["tomorrow", "2026-8-3", "2026/08/03"]) {
      const answered = await call(handler, { url: `/?date=${encodeURIComponent(date)}` });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toMatch(/YYYY-MM-DD/);
    }
  });
});

describe("writing a judgement", () => {
  it("appends the verdict with the prevalence measured at that moment beside it", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, {
      url: "/?date=2026-08-03",
      ...post({ word: "sedate", verdict: "bonus" }),
    });

    expect(answered.status).toBe(200);
    expect(written).toEqual([
      {
        word: "sedate",
        verdict: "bonus",
        measured: 0.2,
        decided: "2026-08-08T12:00:00.000Z",
        note: "",
      },
    ]);
  });

  /**
   * ADR-0015: an empty `measured` means the word had no prevalence row at all —
   * a lemmatiser coverage gap — which is a different population from a genuine
   * disagreement with the data, and the file has to keep them apart.
   */
  it("records a word with no prevalence row as empty rather than as a number", async () => {
    const { handler, written } = endpoint();
    await call(handler, {
      url: "/?date=2026-08-03",
      ...post({ word: "objurgate", verdict: "answer-rare" }),
    });

    expect(written[0]!.measured).toBeNull();
  });

  /**
   * The measured value is the word's *own* row, never the lemma's. `sedates` has
   * no row and would tier on `sedate`'s 0.2 — but recording 0.2 against
   * `sedates` would claim the data had measured a word it never saw.
   */
  it("records the word's own row and never the lemma's it tiers on", async () => {
    const { handler, written } = endpoint();
    await call(handler, {
      url: "/?date=2026-08-03",
      ...post({ word: "sedates", verdict: "bonus" }),
    });

    expect(written[0]!.measured).toBeNull();
  });

  it("answers with the refreshed state, so the standing verdict is the file's", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, {
      url: "/?date=2026-08-03",
      ...post({ word: "sedate", verdict: "bonus" }),
    });

    expect(JSON.parse(answered.body).state.standing).toEqual([
      {
        word: "sedate",
        verdict: "bonus",
        rows: 1,
        decided: "2026-08-08T12:00:00.000Z",
        measured: 0.2,
      },
    ]);
  });

  /**
   * The lemma-family reach, which the maintainer has ruled accepted and which
   * must not be a surprise. `sedates` has no prevalence row of its own, so it
   * tiers on `sedate`'s — and moves with it.
   */
  it("names the other words the judgement now governs", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, {
      url: "/?date=2026-08-03",
      ...post({ word: "sedate", verdict: "bonus" }),
    });

    expect(JSON.parse(answered.body).reach).toEqual(["sedates"]);
  });

  it("counts a second row on a word as a reversal", async () => {
    const { handler } = endpoint();
    await call(handler, { ...post({ word: "sedate", verdict: "bonus" }) });
    const answered = await call(handler, { ...post({ word: "sedate", verdict: "none" }) });

    expect(JSON.parse(answered.body).state.standing[0]).toMatchObject({
      verdict: "none",
      rows: 2,
    });
  });
});

describe("what the endpoint refuses, and writes nothing for", () => {
  // The mechanism is `web/editorRoute.ts`'s and is tested there. The sentence
  // is this route's own, and naming both verbs is how it says there is no third.
  it("answers anything but GET or POST with this route's own refusal", async () => {
    const { handler, written } = endpoint();
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, { ...post({ word: "eight", verdict: "bonus" }), method });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET, POST");
      expect(JSON.parse(answered.body)).toEqual({
        error: "Read the picker with GET, record a judgement with POST.",
      });
      expect(answered.nexted).toBe(false);
    }
    expect(written).toEqual([]);
  });

  it("writes nothing for a body the cap refused", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_TIER_BODY_BYTES + 1),
    });

    expect(answered.status).toBe(413);
    expect(written).toEqual([]);
  });

  it("refuses a body that is not a judgement, and names what was wrong", async () => {
    const { handler, written } = endpoint();
    const bodies: [string, RegExp][] = [
      ["not json at all", /judgement/i],
      [JSON.stringify({ verdict: "bonus" }), /word/i],
      [JSON.stringify({ word: "", verdict: "bonus" }), /word/i],
      [JSON.stringify({ word: "Kate!", verdict: "bonus" }), /word/i],
      [JSON.stringify({ word: "eight" }), /verdict/i],
      [JSON.stringify({ word: "eight", verdict: "demote" }), /verdict/i],
    ];
    for (const [body, expected] of bodies) {
      const answered = await call(handler, { method: "POST", body });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toMatch(expected);
    }
    expect(written).toEqual([]);
  });

  /**
   * A judgement the file refused is a judgement that did not happen, and the
   * screen must not show it as made. The failure is relayed whole for the reason
   * the day endpoint relays its own: the reader is the maintainer, and the paths
   * are their own.
   */
  it("relays a file it could not write to, rather than reporting success", async () => {
    const { handler } = endpoint({
      append: () => {
        throw new Error("EACCES: permission denied, open '/repo/data/tier-overrides.csv'");
      },
    });
    const answered = await call(handler, { ...post({ word: "eight", verdict: "bonus" }) });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("EACCES");
  });
});

describe("what counts as a judgement", () => {
  it("takes the four verdicts and nothing else", () => {
    for (const verdict of ["bonus", "answer-rare", "answer-common", "none"]) {
      expect(tierWriteRequest(JSON.stringify({ word: "eight", verdict }))).toEqual({
        ok: true,
        word: "eight",
        verdict,
      });
    }
    expect(tierWriteRequest(JSON.stringify({ word: "eight", verdict: "answer" })).ok).toBe(false);
  });

  it("normalises the word the way the file's own parser does", () => {
    expect(tierWriteRequest(JSON.stringify({ word: "  Eight  ", verdict: "none" }))).toEqual({
      ok: true,
      word: "eight",
      verdict: "none",
    });
  });
});
