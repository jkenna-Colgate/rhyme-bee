/**
 * The dev-only endpoint the Editor's Pass asks what is true of a list of words
 * through (#189). What the evidence *is* is `src/supplementEvidence.ts` and is
 * tested there; what is tested here is the transport around it — that the facts
 * reach the browser one record per word, that the route decides nothing of its
 * own, and that the parse refuses everything it says it refuses.
 *
 * The parse is `web/editorEvidenceRequest.ts`'s, kept out of the plugin for the
 * reason `editorAddRequest.ts` and `editorDemotionRequest.ts` are, and driven
 * here through the middleware because that is where its refusals become a status
 * and a sentence. No dev server stands up for any of it.
 *
 * The socket ceremony this route shares with the other eight — the body cap, and
 * that no path falls through — is `web/editorRoute.ts`'s and is tested in
 * `editorRoute.test.ts`. What stays here is this route's own 405 *sentence* and
 * its own cap, neither of which is shared.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost; this follows the
 * shape `editorCandidatesEndpoint.test.ts` took.
 */

import { describe, expect, it } from "vitest";
import type { Pronunciation } from "../../src/phonology.ts";
import { evidenceContextFrom, type EvidenceContext } from "../../src/supplementEvidence.ts";
import type { EvidenceReply, WordFacts } from "../src/editor/evidence.ts";
import { editorEvidenceSpec, type EditorEvidenceDeps } from "../editorEvidencePlugin.ts";
import { MAX_EVIDENCE_BODY_BYTES, MAX_EVIDENCE_WORDS } from "../editorEvidenceRequest.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";

const ATE = "EY T";

/**
 * A pinned world small enough to read: five readings, four words and one name.
 *
 * Built through `evidenceContextFrom` rather than by hand, so the context the
 * route is handed is assembled exactly as `pinnedEvidenceContext` assembles the
 * real one — Normalisation applied, and the `Derivation` built last over the
 * normalised map.
 *
 * `outdate` is the composition case and is deliberately **not** given a reading:
 * `out` (`AW1 T`) and `date` (`D EY1 T`) both read, so the split composes
 * `AW1 T D EY2 T`, whose last stressed vowel is the secondary `EY2` and whose
 * Rhyme Key is therefore the target's.
 */
function context(): EvidenceContext {
  const pronunciations = new Map<string, Pronunciation[]>([
    ["out", [["AW1", "T"]]],
    ["date", [["D", "EY1", "T"]]],
    ["plate", [["P", "L", "EY1", "T"]]],
    ["carrot", [["K", "EH1", "R", "AH0", "T"]]],
  ]);
  return evidenceContextFrom({
    pronunciations,
    words: new Set(["out", "date", "plate", "carrot", "outdate", "objurgate"]),
    names: new Set(["kate"]),
  });
}

/**
 * The norms, as three rows and everything else absent. `outdate` sits at a
 * measured zero on purpose: a row saying a word is as unknown as the norms go is
 * a different fact from having no row at all, and the browser orders the two
 * differently.
 */
const PREVALENCE = new Map([
  ["plate", 0.9],
  ["carrot", 0.8],
  ["outdate", 0],
]);

/** The route as connect sees it, with its own 405 sentence and cap included. */
function endpoint(over: Partial<EditorEvidenceDeps> = {}) {
  return editorMiddleware(
    editorEvidenceSpec({ context, prevalence: () => PREVALENCE, ...over }),
  );
}

async function lookup(words: string[], rhymeKey = ATE): Promise<EvidenceReply> {
  const body = JSON.stringify({ rhymeKey, words });
  const answered = await call(endpoint(), { method: "POST", url: "/", body });
  expect(answered.status).toBe(200);
  return JSON.parse(answered.body) as EvidenceReply;
}

function factsFor(reply: EvidenceReply, word: string): WordFacts {
  const found = reply.words.find((entry) => entry.word === word);
  if (found === undefined) throw new Error(`no evidence for ${word}`);
  return found;
}

describe("the dev-only evidence endpoint", () => {
  it("answers one record per word, in the order they were asked about", async () => {
    const reply = await lookup(["plate", "outdate", "kate"]);

    expect(reply.words.map((entry) => entry.word)).toEqual(["plate", "outdate", "kate"]);
  });

  it("names the Rhyme Key it held the words against", async () => {
    // It travels back so the browser can check the facts are still about the day
    // on screen. Composition is aimed at one key, so evidence gathered for a day
    // the editor has navigated away from would mark the wrong words resolvable.
    expect((await lookup(["plate"])).rhymeKey).toBe(ATE);
  });

  it("answers with wordhood, name status and readings rather than a verdict", async () => {
    const reply = await lookup(["plate", "carrot", "kate", "outdate"]);

    expect(factsFor(reply, "plate")).toMatchObject({ isWord: true, rhymesDirectly: true });
    expect(factsFor(reply, "carrot")).toMatchObject({ isWord: true, rhymesDirectly: false });
    expect(factsFor(reply, "kate")).toMatchObject({ isWord: false, isName: true });
    expect(factsFor(reply, "outdate")).toMatchObject({ isWord: true, direct: [] });
  });

  it("composes a reading for a compound the split reaches the target with", async () => {
    const composed = factsFor(await lookup(["outdate"]), "outdate").composed;

    expect(composed?.key).toBe(ATE);
    expect(composed?.phonemes).toEqual(["AW1", "T", "D", "EY2", "T"]);
    expect(composed?.head.word).toBe("out");
    expect(composed?.tail.word).toBe("date");
  });

  it("composes nothing when no split reaches the target", async () => {
    // The same word against another key. `verifyReading` is exact equality
    // (ADR-0014), so a split that landed elsewhere is not offered at all.
    const reply = await lookup(["outdate"], "AA T IH K");

    expect(factsFor(reply, "outdate").composed).toBeNull();
  });

  it("carries each word's own prevalence row, and null when it has none", async () => {
    const reply = await lookup(["plate", "objurgate"]);

    expect(factsFor(reply, "plate").knownness).toBe(0.9);
    expect(factsFor(reply, "objurgate").knownness).toBeNull();
  });

  it("keeps a measured zero apart from no row at all", async () => {
    expect(factsFor(await lookup(["outdate"]), "outdate").knownness).toBe(0);
  });

  it("answers about a word with no wordhood rather than refusing it", async () => {
    // The demotable pile is made of these, so a name has to come back with
    // its facts on it — not be dropped for failing a test this route does not
    // apply. Wordhood is the browser's line to draw, not the wire's.
    const reply = await lookup(["kate"]);

    expect(reply.words).toHaveLength(1);
    expect(factsFor(reply, "kate")).toMatchObject({ isWord: false, isName: true });
  });

  it("normalises what it is asked about, so the answer is about that word", async () => {
    const reply = await lookup([" Plate "]);

    expect(reply.words.map((entry) => entry.word)).toEqual(["plate"]);
  });

  it("answers an empty list with an empty reply rather than an error", async () => {
    // A residue of nothing is the day covering the whole paste, which is the
    // best outcome the tool has and not a malformed request.
    expect(await lookup([])).toEqual({ rhymeKey: ATE, words: [] });
  });

  it("refuses a body that names no Rhyme Key", async () => {
    const answered = await call(endpoint(), {
      method: "POST",
      url: "/",
      body: JSON.stringify({ words: ["plate"] }),
    });

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toContain("not a Rhyme Key");
  });

  it("refuses a body that is not JSON, and one that is not an object", async () => {
    for (const body of ["not json", '"a string"']) {
      const answered = await call(endpoint(), { method: "POST", url: "/", body });
      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toContain("not an evidence lookup");
    }
  });

  it("refuses a malformed word, naming it", async () => {
    const answered = await call(endpoint(), {
      method: "POST",
      url: "/",
      body: JSON.stringify({ rhymeKey: ATE, words: ["plate", "hard hat"] }),
    });

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toContain("hard hat");
  });

  it("refuses a list that names the same word twice", async () => {
    const answered = await call(endpoint(), {
      method: "POST",
      url: "/",
      body: JSON.stringify({ rhymeKey: ATE, words: ["plate", "Plate"] }),
    });

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toContain("same word twice");
  });

  it("refuses more words than one lookup answers about", async () => {
    const words = Array.from({ length: MAX_EVIDENCE_WORDS + 1 }, (_, i) => `word${i}`);
    const answered = await call(endpoint(), {
      method: "POST",
      url: "/",
      body: JSON.stringify({ rhymeKey: ATE, words }),
    });

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toContain(String(MAX_EVIDENCE_WORDS));
  });

  it("refuses a body over the cap without opening a pinned source", async () => {
    const oversize = MAX_EVIDENCE_BODY_BYTES + 1;
    let opened = false;
    const answered = await call(
      endpoint({
        context: () => {
          opened = true;
          return context();
        },
      }),
      {
        method: "POST",
        url: "/",
        body: "x".repeat(oversize),
        headers: { "content-length": String(oversize) },
      },
    );

    expect(answered.status).toBe(413);
    expect(answered.nexted).toBe(false);
    expect(opened).toBe(false);
  });

  it("refuses every verb but POST, saying what the route is for", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const answered = await call(endpoint(), { method, url: "/" });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("POST");
      expect(JSON.parse(answered.body).error).toContain("Nothing here is written.");
      expect(answered.nexted).toBe(false);
    }
  });

  it("relays a missing pinned source, remedy and all", async () => {
    const handler = endpoint({
      context: () => {
        throw new Error("ENOENT: no such file or directory, open '/repo/data/cmudict.dict'");
      },
    });
    const answered = await call(handler, {
      method: "POST",
      url: "/",
      body: JSON.stringify({ rhymeKey: ATE, words: ["plate"] }),
    });

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("data/cmudict.dict");
  });
});
