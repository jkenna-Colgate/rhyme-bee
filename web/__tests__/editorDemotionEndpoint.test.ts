/**
 * The dev-only endpoint the Editor's Pass demotes a word through. What a
 * demotion *means* is `src/demotions.ts`, what it does to the day on screen is
 * `web/__tests__/demote.test.ts`, and what happens to the file underneath it is
 * `web/__tests__/demotionFile.test.ts`; what is tested here is the transport
 * around them — that only the two verbs it answers are answered, that a body is
 * capped rather than buffered, that every refusal writes nothing, and that an
 * accepted demotion reaches the file with the reason the editor chose.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost;
 * `web/__tests__/editorTierEndpoint.test.ts` is the shape those tests took and
 * the shape these follow.
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serialiseDemotion, type Demotion } from "../../src/demotions.ts";
import { MAX_DEMOTION_BODY_BYTES, demotionWriteRequest } from "../editorDemotionRequest.ts";
import { editorDemotionHandler } from "../editorDemotionPlugin.ts";

interface Answered {
  status: number;
  headers: Record<string, string>;
  body: string;
  nexted: boolean;
}

/** Call the handler the way connect does, mounted prefix already stripped. */
async function call(
  handler: ReturnType<typeof editorDemotionHandler>,
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

/** The endpoint with the file replaced by a string, so nothing touches `data/`. */
function endpoint(options: { file?: string; append?: (demotion: Demotion) => void } = {}) {
  const written: Demotion[] = [];
  let text = options.file ?? "";
  const handler = editorDemotionHandler({
    demotions: () => text,
    append:
      options.append ??
      ((demotion) => {
        written.push(demotion);
        text += serialiseDemotion(demotion);
      }),
  });
  return { handler, written };
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("reading the demotion list", () => {
  it("answers with every entry the file holds", async () => {
    const { handler } = endpoint({
      file: "# names the word list wrongly calls words\nheinz proper-noun  # H. J. Heinz\nlbs not-a-known-word\n",
    });
    const answered = await call(handler);

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(answered.body)).toEqual({
      standing: [
        { word: "heinz", reason: "proper-noun" },
        { word: "lbs", reason: "not-a-known-word" },
      ],
    });
  });

  it("answers a file that is not there as no demotions at all", async () => {
    const { handler } = endpoint();

    expect(JSON.parse((await call(handler)).body)).toEqual({ standing: [] });
  });
});

describe("writing a demotion", () => {
  it("appends the word with the reason the editor chose", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, post({ word: "kate", reason: "proper-noun" }));

    expect(answered.status).toBe(200);
    expect(written).toEqual([{ word: "kate", reason: "proper-noun" }]);
  });

  /**
   * Both reasons the format allows must land as chosen. The second column is the
   * rejection the player actually receives, so a route that collapsed the two
   * would tell a player an abbreviation is somebody's name.
   */
  it("writes the other reason as the other reason, never a default", async () => {
    const { handler, written } = endpoint();
    await call(handler, post({ word: "lbs", reason: "not-a-known-word" }));

    expect(written).toEqual([{ word: "lbs", reason: "not-a-known-word" }]);
  });

  it("answers with the refreshed state, so the screen's list is the file's", async () => {
    const { handler } = endpoint({ file: "heinz proper-noun\n" });
    const answered = await call(handler, post({ word: "kate", reason: "proper-noun" }));

    expect(JSON.parse(answered.body)).toEqual({
      state: {
        standing: [
          { word: "heinz", reason: "proper-noun" },
          { word: "kate", reason: "proper-noun" },
        ],
      },
      appended: { word: "kate", reason: "proper-noun" },
    });
  });

  it("normalises the word the way the file's own parser does", async () => {
    const { handler, written } = endpoint();
    await call(handler, post({ word: "  Kate  ", reason: "proper-noun" }));

    expect(written).toEqual([{ word: "kate", reason: "proper-noun" }]);
  });
});

describe("what the endpoint refuses, and writes nothing for", () => {
  it("answers anything but GET or POST with a method refusal", async () => {
    const { handler, written } = endpoint();
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, {
        ...post({ word: "kate", reason: "proper-noun" }),
        method,
      });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET, POST");
      expect(answered.nexted).toBe(false);
    }
    expect(written).toEqual([]);
  });

  /**
   * There is no un-demote anywhere in the tool, and the route is where that is
   * enforced rather than merely unbuilt: a DELETE is refused as a method, so a
   * reversal stays the hand edit the ticket makes it.
   */
  it("offers no verb that removes an entry", async () => {
    const { handler, written } = endpoint({ file: "kate proper-noun\n" });
    const answered = await call(handler, { method: "DELETE", body: JSON.stringify({ word: "kate" }) });

    expect(answered.status).toBe(405);
    expect(written).toEqual([]);
  });

  it("refuses a body over the cap", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_DEMOTION_BODY_BYTES + 1),
    });

    expect(answered.status).toBe(413);
    expect(written).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_DEMOTION_BODY_BYTES + 1),
      headers: { "content-length": "42" },
    });

    expect(answered.status).toBe(413);
    expect(written).toEqual([]);
  });

  it("refuses a declared size over the cap before a byte of it arrives", async () => {
    const { handler, written } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      headers: { "content-length": String(MAX_DEMOTION_BODY_BYTES + 1) },
    });

    expect(answered.status).toBe(413);
    expect(written).toEqual([]);
  });

  it("refuses a body that is not a demotion, and names what was wrong", async () => {
    const { handler, written } = endpoint();
    const bodies: [string, RegExp][] = [
      ["not json at all", /demotion/i],
      [JSON.stringify({ reason: "proper-noun" }), /word/i],
      [JSON.stringify({ word: "", reason: "proper-noun" }), /word/i],
      [JSON.stringify({ word: "Kate!", reason: "proper-noun" }), /word/i],
      [JSON.stringify({ word: "kate" }), /reason/i],
      [JSON.stringify({ word: "kate", reason: "bonus" }), /reason/i],
      [JSON.stringify({ word: "kate", reason: "junk" }), /reason/i],
    ];
    for (const [body, expected] of bodies) {
      const answered = await call(handler, { method: "POST", body });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toMatch(expected);
    }
    expect(written).toEqual([]);
  });

  /**
   * `applyDemotions` (`src/demotions.ts`) would not actually let a second line
   * decide the player's rejection — `words.delete` and `names.add` are
   * idempotent, so a `proper-noun` line anywhere in the file wins regardless of
   * where a second line for the same word sits. What a second line *would* do is
   * sit there inertly, breaking the "lists each word once" invariant
   * `src/__tests__/demotions.test.ts` holds of the committed file for no effect
   * on adjudication. The refusal keeps the file at one row per word.
   */
  it("refuses a word the file already demotes rather than writing it twice", async () => {
    const { handler, written } = endpoint({ file: "kate proper-noun\n" });
    const answered = await call(handler, post({ word: "kate", reason: "not-a-known-word" }));

    expect(answered.status).toBe(409);
    const error: string = JSON.parse(answered.body).error;
    expect(error).toMatch(/already demoted, as proper-noun/);
    // The sentence says the word has no wordhood; the client appends its own
    // "still a word" reassurance to every *other* refusal, and must not find
    // an excuse to on this one — see `showsDemotionReassurance` in
    // `web/src/editor/demote.ts`.
    expect(error).not.toMatch(/still a word/);
    expect(written).toEqual([]);
  });

  /**
   * A demotion the file refused is a demotion that did not happen, and the
   * screen must not show it as made. The failure is relayed whole for the reason
   * the Tier route relays its own: the reader is the maintainer, and the paths
   * are their own.
   */
  it("relays a file it could not write to, rather than reporting success", async () => {
    const { handler } = endpoint({
      append: () => {
        throw new Error("EACCES: permission denied, open '/repo/data/demotions.txt'");
      },
    });
    const answered = await call(handler, post({ word: "kate", reason: "proper-noun" }));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("EACCES");
  });

  /**
   * A demotion list that will not parse is the build's own failure, met here
   * first. It must not be answered with an empty list, which would read as "this
   * word is not demoted" and invite an append onto a broken file.
   */
  it("relays an unreadable demotion list rather than reading it as empty", async () => {
    const { handler, written } = endpoint({ file: "heinz\n" });
    const answered = await call(handler, post({ word: "kate", reason: "proper-noun" }));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toMatch(/heinz/);
    expect(written).toEqual([]);
  });
});

describe("what counts as a demotion", () => {
  it("takes the two reasons and nothing else", () => {
    for (const reason of ["proper-noun", "not-a-known-word"]) {
      expect(demotionWriteRequest(JSON.stringify({ word: "kate", reason }))).toEqual({
        ok: true,
        word: "kate",
        reason,
      });
    }
    expect(demotionWriteRequest(JSON.stringify({ word: "kate", reason: "name" })).ok).toBe(false);
  });
});
