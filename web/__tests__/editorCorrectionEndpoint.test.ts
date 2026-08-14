/**
 * The dev-only endpoint the Editor's Pass corrects a reading through. What a
 * correction *is* — the proposal, the replace-versus-join write and the
 * union-of-keys recheck — is `scripts/__tests__/editorCorrection.test.ts`, and
 * the browser-side rules are `web/__tests__/correction.test.ts`. What is tested
 * here is the transport around them: that every refusal writes nothing, that the
 * proposal ask **writes nothing either**, and that an approval reaches the file.
 *
 * The route stays thin because the module does the work, which is the shape the
 * queue route already takes. The socket ceremony this route shares with the
 * others — the verb check, the body cap, and that no path falls through — is
 * `web/editorRoute.ts`'s and is tested in `editorRoute.test.ts`; what stays here
 * is this route's own 405 sentence and every claim about `data/supplement.dict`.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Derivation, IndexDataSource } from "../../src/derivation.ts";
import type { Pronunciation } from "../../src/phonology.ts";
import type { Schedule } from "../../src/schedule.ts";
import type { EvidenceContext } from "../../src/supplementEvidence.ts";
import { makeTestIndex } from "../../src/__fixtures__/index.ts";
import { editorCorrectionSpec } from "../editorCorrectionPlugin.ts";
import { MAX_CORRECTION_BODY_BYTES } from "../editorCorrectionRequest.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";

let dir: string;
let supplementPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-correction-route-"));
  supplementPath = join(dir, "supplement.dict");
  writeFileSync(supplementPath, "# a committed supplement\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const index = makeTestIndex();

const schedule: Schedule = {
  startDate: "2026-09-01",
  band: { min: 1, max: 500 },
  days: [
    {
      date: "2026-09-01",
      weekday: "Tue",
      week: 1,
      seed: "ate",
      rhymeKey: index.pinSeed("ate").rhymeKey,
      answerCount: 1,
      difficulty: 0.1,
    },
  ],
};

/** The pinned-source context, with `cat` reading on a key that is not `EY T`. */
function context(): EvidenceContext {
  const pronunciations = new Map<string, Pronunciation[]>([["cat", [["K", "AE1", "T"]]]]);
  const words = new Set(["cat"]);
  const names = new Set<string>();
  return {
    pronunciations,
    words,
    names,
    derivation: new Derivation(new IndexDataSource({ words, pronunciations })),
  };
}

const rebuild = vi.fn(async () => ({ ok: true as const }));

/** The route over a temp supplement, so nothing ever touches the repository's `data/`. */
function endpoint(author: () => Promise<Pronunciation | null> = async () => ["K", "EY1", "T"]) {
  return editorMiddleware(
    editorCorrectionSpec({
      context,
      schedule: () => schedule,
      openIndex: () => index,
      rebuild,
      author,
      supplementPath,
    }),
  );
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** What is on disk now — the only claim worth making about a write. */
const supplement = () => readFileSync(supplementPath, "utf8");

describe("asking for a proposal", () => {
  it("answers with the agent's reading beside the engine's, and writes nothing", async () => {
    const before = supplement();
    const answered = await call(endpoint(), post({ word: "cat", rhymeKey: "EY T" }));

    expect(answered.status).toBe(200);
    expect(answered.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(answered.body)).toMatchObject({
      outcome: "proposed",
      word: "cat",
      target: "EY T",
      current: [{ phonemes: ["K", "AE1", "T"], key: "AE T" }],
      phonemes: ["K", "EY1", "T"],
      key: "EY T",
      reaches: true,
    });
    // The whole guarantee of the two-step: a proposal the editor disagrees with
    // costs nothing, so asking for one leaves the file byte for byte as it was.
    expect(supplement()).toBe(before);
  });

  it("never rebuilds the index for a proposal", async () => {
    rebuild.mockClear();
    await call(endpoint(), post({ word: "cat", rhymeKey: "EY T" }));
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("reports an agent that did not answer, still having written nothing", async () => {
    const before = supplement();
    const answered = await call(endpoint(async () => null), post({ word: "cat", rhymeKey: "EY T" }));

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toMatchObject({ outcome: "agent-unavailable" });
    expect(supplement()).toBe(before);
  });
});

describe("approving a correction", () => {
  it("writes the reading and rechecks the days on the word's keys", async () => {
    rebuild.mockClear();
    const answered = await call(
      endpoint(),
      post({ word: "cat", rhymeKey: "EY T", phonemes: ["K", "EY1", "T"], mode: "replace" }),
    );

    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toMatchObject({
      word: "cat",
      mode: "replace",
      written: [["K", "EY1", "T"]],
      keysBefore: ["AE T"],
      keysAfter: ["EY T"],
      rechecked: ["AE T", "EY T"],
    });
    expect(supplement()).toContain("cat K EY1 T");
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("writes both readings as alternates for a join", async () => {
    await call(
      endpoint(),
      post({ word: "cat", rhymeKey: "EY T", phonemes: ["K", "EY1", "T"], mode: "join" }),
    );

    expect(supplement()).toContain("cat K AE1 T");
    expect(supplement()).toContain("cat(2) K EY1 T");
  });

  it("never asks the agent again — the reading it approves came in the body", async () => {
    const author = vi.fn(async () => ["K", "AA1", "T"] as Pronunciation);
    await call(
      endpoint(author),
      post({ word: "cat", rhymeKey: "EY T", phonemes: ["K", "EY1", "T"], mode: "replace" }),
    );

    expect(author).not.toHaveBeenCalled();
    expect(supplement()).toContain("cat K EY1 T");
  });
});

describe("what the endpoint refuses, and writes nothing for", () => {
  const REFUSAL =
    "Propose or approve a correction with POST. Asking for one writes nothing; only an " +
    "approval naming a reading does.";

  it("answers anything but POST with this route's own refusal", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(endpoint(), { method });

      expect(answered.status).toBe(405);
      expect(JSON.parse(answered.body)).toEqual({ error: REFUSAL });
      expect(answered.nexted).toBe(false);
    }
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses a body past the cap without reading it", async () => {
    const body = JSON.stringify({
      word: "cat",
      rhymeKey: "EY T",
      phonemes: new Array(500).fill("K"),
      mode: "replace",
    });
    expect(body.length).toBeGreaterThan(MAX_CORRECTION_BODY_BYTES);

    const answered = await call(endpoint(), { method: "POST", body });

    expect(answered.status).toBe(413);
    expect(answered.nexted).toBe(false);
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses a body that is not a correction at all", async () => {
    for (const body of ["", "not json", "[]", "null"]) {
      const answered = await call(endpoint(), { method: "POST", body });
      expect(answered.status).toBe(400);
    }
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses an approval whose reading is not phonemes", async () => {
    const answered = await call(
      endpoint(),
      post({ word: "cat", rhymeKey: "EY T", phonemes: ["not a phoneme"], mode: "replace" }),
    );

    expect(answered.status).toBe(400);
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses an approval that names no mode, rather than choosing one", async () => {
    const answered = await call(
      endpoint(),
      post({ word: "cat", rhymeKey: "EY T", phonemes: ["K", "EY1", "T"] }),
    );

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toContain("only the editor knows which");
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses a mode with no reading rather than reading it as a proposal ask", async () => {
    const answered = await call(endpoint(), post({ word: "cat", rhymeKey: "EY T", mode: "join" }));

    expect(answered.status).toBe(400);
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("refuses a request with no Rhyme Key to judge the proposal against", async () => {
    const answered = await call(endpoint(), post({ word: "cat" }));

    expect(answered.status).toBe(400);
    expect(supplement()).toBe("# a committed supplement\n");
  });

  it("never falls through to the next middleware, whatever it refused", async () => {
    for (const answered of [
      await call(endpoint(), { method: "GET" }),
      await call(endpoint(), { method: "POST", body: "not json" }),
      await call(endpoint(), post({ word: "cat", rhymeKey: "EY T" })),
    ]) {
      expect(answered.nexted).toBe(false);
    }
  });
});
