/**
 * The dev-only endpoint the Editor's Pass declines a Candidate through. What a
 * Decline *means* is `src/declines.ts`, what the gesture offers and what each
 * ruling costs is `web/__tests__/decline.test.ts`, and what happens to the file
 * underneath it is `web/__tests__/declinesFile.test.ts`; what is tested here is
 * the transport around them — that every refusal writes nothing, and that an
 * accepted ruling reaches the file keyed on the word and the Rhyme Key together.
 *
 * There is nothing here about *reading* the standing rulings, because the route
 * has no verb that does: the queue readout derives `declined` for every
 * Candidate on screen, which is where the browser learns it (#176).
 *
 * The socket ceremony this route shares with the other five — the verb check,
 * the body cap, and that no path falls through — is `web/editorRoute.ts`'s and
 * is tested in `editorRoute.test.ts`. What stays here is this route's own 405
 * *sentence*, and every claim about what a refusal does to `data/declines.txt`.
 *
 * The file is a **real file in a temp directory** rather than an array, which is
 * the one place this suite departs from `editorDemotionEndpoint.test.ts`. That
 * route injects its IO; this one injects a **path**, following
 * `AddDeps.deferredPath`, so there is one adapter and the route's tests exercise
 * it. `web/__tests__/tierOverrideFile.test.ts` is where the technique started.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDeclines } from "../../src/declines.ts";
import { editorDeclineSpec } from "../editorDeclinePlugin.ts";
import { MAX_DECLINE_BODY_BYTES, declineWriteRequest } from "../editorDeclineRequest.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-decline-route-"));
  path = join(dir, "declines.txt");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The route over a temp file, so nothing ever touches the repository's `data/`. */
function endpoint(file?: string) {
  if (file !== undefined) writeFileSync(path, file);
  return editorMiddleware(editorDeclineSpec({ declinesPath: path }));
}

/** What is on disk now, parsed — the only claim worth making about a write. */
function onDisk() {
  return parseDeclines(readFileSync(path, "utf8"));
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("writing a Decline", () => {
  it("appends the word and the Rhyme Key the Candidate was aimed at", async () => {
    const answered = await call(endpoint(), post({ word: "docked", rhymeKey: "AA K T" }));

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(onDisk()).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  /**
   * The ruling as written and **nothing else** — no copy of the file's refreshed
   * state. Which Candidates stand declined is derived server-side on every read
   * of the queue, and deriving it in one place is the point (#176); a second copy
   * answered here would be a second answer to one question.
   */
  it("answers with the ruling it wrote, and no second copy of the file", async () => {
    const handler = endpoint("talked AA K T\n");
    const answered = await call(handler, post({ word: "docked", rhymeKey: "AA K T" }));

    expect(JSON.parse(answered.body)).toEqual({
      appended: { word: "docked", rhymeKey: "AA K T" },
    });
  });

  /**
   * The ticket's own rule, and the reason this file exists rather than a column
   * on the demotion list: a ruling is about a word *aimed at a target*, so the
   * same word declined against one Rhyme Key is untouched against another.
   */
  it("records one word's two Rhyme Keys as two rulings", async () => {
    const handler = endpoint();
    await call(handler, post({ word: "docked", rhymeKey: "AA K T" }));
    const answered = await call(handler, post({ word: "docked", rhymeKey: "AA K" }));

    expect(answered.status).toBe(200);
    expect(onDisk()).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "docked", rhymeKey: "AA K" },
    ]);
  });

  it("normalises the word the way the file's own parser does", async () => {
    await call(endpoint(), post({ word: "  Docked ", rhymeKey: "AA K T" }));

    expect(onDisk()).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  it("repairs a file whose last line lost its newline, rather than fusing", async () => {
    await call(endpoint("talked AA K T"), post({ word: "docked", rhymeKey: "AA K T" }));

    expect(onDisk()).toEqual([
      { word: "talked", rhymeKey: "AA K T" },
      { word: "docked", rhymeKey: "AA K T" },
    ]);
  });
});

describe("what the endpoint refuses, and writes nothing for", () => {
  const REFUSAL =
    "Record a Decline with POST. What is already declined is on the Candidate Queue readout.";

  /**
   * `GET` among them, which is the verb this route deliberately does not have.
   * Nothing read it: the queue readout already carries the derived `declined`
   * state for every Candidate on screen, so a verb serving the standing rulings a
   * second way was a payload built and tested for nobody.
   */
  it("answers anything but POST with this route's own refusal", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(endpoint(), { method });

      expect(answered.status).toBe(405);
      expect(JSON.parse(answered.body)).toEqual({ error: REFUSAL });
      expect(answered.nexted).toBe(false);
    }
  });

  /**
   * There is no un-decline, here or in the browser. Reversing a ruling is a hand
   * edit of a committed file, which is the demotion list's position arrived at
   * from the other direction — there because an un-demote is a click away from
   * serving a name again, here because undoing a Decline costs one Candidate
   * reappearing on a screen only the editor sees.
   */
  it("offers no verb that removes a ruling", async () => {
    const handler = endpoint("docked AA K T\n");
    const answered = await call(handler, { method: "DELETE" });

    expect(answered.status).toBe(405);
    expect(onDisk()).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  it("writes nothing for a body the cap refused", async () => {
    const handler = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_DECLINE_BODY_BYTES + 1),
    });

    expect(answered.status).toBe(413);
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("refuses a body that is not a Decline, and names what was wrong", async () => {
    const cases: [unknown, string][] = [
      ["not json at all", "That request body is not a Decline."],
      [{ rhymeKey: "AA K T" }, "is not a word"],
      [{ word: "doc ked", rhymeKey: "AA K T" }, "is not a word"],
      [{ word: "docked" }, "is not a Rhyme Key"],
      [{ word: "docked", rhymeKey: "aa k t" }, "is not a Rhyme Key"],
      [{ word: "docked", rhymeKey: 42 }, "is not a Rhyme Key"],
    ];

    for (const [body, fragment] of cases) {
      const handler = endpoint();
      const answered = await call(handler, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toContain(fragment);
      expect(() => readFileSync(path, "utf8")).toThrow();
    }
  });

  /**
   * Only reachable from a screen that has gone stale — a declined Candidate
   * comes back from the queue readout already settled — but a second identical
   * row is inert and would still be read by the next maintainer as a second
   * ruling. 409 because the request is fine and the file's state is what refuses
   * it, which is also what a retry will keep doing.
   */
  it("refuses a pair the file already holds rather than writing it twice", async () => {
    const handler = endpoint("docked AA K T\n");
    const answered = await call(handler, post({ word: "docked", rhymeKey: "AA K T" }));

    expect(answered.status).toBe(409);
    expect(JSON.parse(answered.body).error).toContain("already declined against AA K T");
    expect(onDisk()).toEqual([{ word: "docked", rhymeKey: "AA K T" }]);
  });

  it("relays a file it could not write to, rather than reporting success", async () => {
    // A path whose parent is a *file* cannot be written, and the cause names it.
    writeFileSync(path, "");
    const handler = editorMiddleware(
      editorDeclineSpec({ declinesPath: join(path, "declines.txt") }),
    );
    const answered = await call(handler, post({ word: "docked", rhymeKey: "AA K T" }));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("Could not record that Decline");
  });
});

describe("what counts as a Decline", () => {
  it("takes a word and a Rhyme Key, both required", () => {
    expect(declineWriteRequest(JSON.stringify({ word: "docked", rhymeKey: "AA K T" }))).toEqual({
      ok: true,
      word: "docked",
      rhymeKey: "AA K T",
    });
  });

  it("keeps the spaces inside a Rhyme Key and trims the ones around it", () => {
    expect(declineWriteRequest(JSON.stringify({ word: "docked", rhymeKey: " AA K T " }))).toEqual({
      ok: true,
      word: "docked",
      rhymeKey: "AA K T",
    });
  });

  it("refuses a Decline with no Rhyme Key, because the key is half the ruling", () => {
    const asked = declineWriteRequest(JSON.stringify({ word: "docked" }));

    expect(asked.ok).toBe(false);
    expect(asked.ok === false && asked.error).toContain("Appealed against another");
  });
});
