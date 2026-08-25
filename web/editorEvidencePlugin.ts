/**
 * The dev-only endpoint the Editor's Pass asks **what is true of a list of
 * words** through (#189): wordhood, name status, the readings the pinned sources
 * hold, a reading composed from a compound split when one reaches the day's
 * Rhyme Key, and each word's prevalence row.
 *
 * A Vite plugin that runs during `npm run dev` only — `web/editorRoute.ts`
 * builds it from the spec below and declares the `apply: "serve"` that stops
 * `configureServer` ever running in a production build — answering `POST` alone
 * on `/api/editor/evidence`.
 *
 * ## Why it exists at all
 *
 * The pasted rhyme list's residue has to be split on wordhood, and every fact
 * that split turns on is Node-only. `EvidenceContext` holds the pronunciation
 * map, the word list, the names and a `Derivation`; the prevalence norms are a
 * fourth file beside it. No module under `web/src/` has ever opened one of
 * those, and none should — so this is the seam that carries the facts across.
 *
 * ## It answers with evidence and never with buckets
 *
 * That is #189's load-bearing decision and `web/src/editor/evidence.ts` argues
 * it at length. The short of it: how the residue is grouped is a browser
 * decision that #190, #191 and #192 each change, while a fact about a word does
 * not move — and shipping buckets over the wire would put the join itself behind
 * an HTTP call, where neither the view nor a test could reach it.
 *
 * What is left here is therefore nearly empty, which is the point:
 * `gatherEvidence` per word and a map read, over machinery
 * `src/__tests__/supplementEvidence.test.ts` already covers.
 *
 * ## `POST`, and still a read
 *
 * `POST` because 274 words do not fit a query string. It is nonetheless a read
 * and the third of the editor routes that **writes nothing** — no file under
 * `data/`, no rebuild, no subprocess — after the status one and the Candidate
 * Queue. #186's constraint is that the feature adds **no new write path**:
 * acceptance goes through the existing add route and demotion through the
 * existing demotion route, because a second way to write the pronunciation
 * supplement is the thing that design most needs to avoid. This adds no writer.
 *
 * ## One key, never a set
 *
 * The target arrives on the request and is passed to `gatherEvidence` unchanged,
 * so `composeReading` searches for a split landing on that one key. ADR-0014
 * measured the alternative: 0.12% wrong against a single key, 62.0% against the
 * 260 scheduled ones. Nothing here may widen the target, and there is no shape
 * in which it could — the request carries one string.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * It reads the pinned sources off the maintainer's disk. Three things make its
 * absence from production structural rather than likely: `apply: "serve"`, which
 * `web/editorRoute.ts` states once for every editor route; `vite.config.ts`
 * naming the build's inputs so `editor.html` is never bundled; and no Worker
 * route answering this path (ADR-0016).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parsePrevalenceCsv } from "../src/pipeline.ts";
import { gatherEvidence, type EvidenceContext } from "../src/supplementEvidence.ts";
import { pinnedEvidenceContext } from "../scripts/editorAdd.ts";
import { editorRoute, type EditorRouteSpec } from "./editorRoute.ts";
import { MAX_EVIDENCE_BODY_BYTES, evidenceReadRequest } from "./editorEvidenceRequest.ts";
import { relayCause, sendJson } from "./editorTransport.ts";
import { repoRoot } from "./repoRoot.ts";
import type { EvidenceReply, WordFacts } from "./src/editor/evidence.ts";
import { EDITOR_EVIDENCE_PATH } from "./src/endpoints.ts";

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server and no `data/` directory. Two reads and no writes.
 *
 * `context` is by far the heavier — it parses `data/cmudict.dict`, applies the
 * committed supplement and then Normalisation — and it is called per request
 * rather than cached, like `editorCandidatesPlugin.ts`'s and for the same
 * reason: a reading landing in `data/supplement.dict` should stop this route
 * reporting the word as unread, and a context held for the dev server's lifetime
 * would keep answering as the sources stood when the server started.
 */
export interface EditorEvidenceDeps {
  context: () => EvidenceContext;
  /**
   * The pinned prevalence norms, keyed by word.
   *
   * A second thunk rather than a widening of `EvidenceContext`, which carries no
   * prevalence and is shared with four other callers that do not want any. The
   * join takes **one** evidence argument all the same — the two are merged into
   * {@link WordFacts} here, on this side of the wire — so the pure module stays
   * callable over a single hand-built fixture.
   */
  prevalence: () => ReadonlyMap<string, number>;
}

/**
 * The route's own work, over a body the shared skeleton has already read and
 * capped.
 *
 * One `try` around the whole of it, unlike the add route's four: everything that
 * can throw here is a pinned source that will not parse, every one of those
 * already names its own file, and none of them quotes a path under `dist-data/`
 * that `relayCause` would have to withhold.
 */
export function editorEvidenceHandler(deps: EditorEvidenceDeps) {
  return (_req: IncomingMessage, res: ServerResponse, body: string): void => {
    const asked = evidenceReadRequest(body);
    if (!asked.ok) return sendJson(res, 400, { error: asked.error });

    try {
      const ctx = deps.context();
      const prevalence = deps.prevalence();
      const words: WordFacts[] = asked.words.map((word) => ({
        ...gatherEvidence(word, asked.rhymeKey, ctx),
        // `??` and not `|| null`: a prevalence of 0 is a measured row saying the
        // word is as unknown as the norms go, which is a different fact from
        // having no row at all — and the browser orders the two differently.
        knownness: prevalence.get(word) ?? null,
      }));

      const reply: EvidenceReply = { rhymeKey: asked.rhymeKey, words };
      sendJson(res, 200, reply);
    } catch (error) {
      relayCause(res, "Could not read the evidence for those words", error);
    }
  };
}

/** The route, as everything the shared skeleton needs to mount and guard it. */
export function editorEvidenceSpec(deps: EditorEvidenceDeps): EditorRouteSpec {
  return {
    path: EDITOR_EVIDENCE_PATH,
    verbs: ["POST"],
    refusal:
      "Ask what is true of a list of words with POST, naming the Rhyme Key to hold them against. " +
      "Nothing here is written.",
    cap: MAX_EVIDENCE_BODY_BYTES,
    handle: editorEvidenceHandler(deps),
  };
}

/**
 * The pinned prevalence norms, parsed once and kept. 62k rows and a few
 * megabytes, and — unlike the pronunciation sources above — nothing this tool
 * writes ever changes them: `data/tier-overrides.csv` is a **separate** layer
 * that the index build merges over these, and ADR-0015 reads an empty measured
 * value as "the word had no prevalence row at all". So the norms are what an
 * override is judged *against*, and reading them patched would be reading the
 * verdict back as the evidence for itself. `editorTierPlugin.ts` holds the same
 * value for the same reason and states it at greater length.
 */
let norms: ReadonlyMap<string, number> | null = null;
function measuredPrevalence(): ReadonlyMap<string, number> {
  norms ??= parsePrevalenceCsv(readFileSync(resolve(repoRoot, "data/prevalence.csv"), "utf8"));
  return norms;
}

export function editorEvidencePlugin(): Plugin {
  return editorRoute(
    editorEvidenceSpec({ context: pinnedEvidenceContext, prevalence: measuredPrevalence }),
  );
}
