/**
 * The dev-only endpoint the Editor's Pass sets a word's **Tier** through — the
 * act the whole web mode exists for (ADR-0016). A Vite plugin that, during
 * `npm run dev` only (`apply: "serve"`, so `configureServer` never runs in a
 * production build), answers two verbs on `/api/editor/tier`:
 *
 * - `GET` returns what the picker needs and the day readout does not carry: the
 *   standing verdicts in `data/tier-overrides.csv`, and the lemma walk and
 *   measured prevalence behind each of the day's words.
 * - `POST` appends one judgement to that file **and returns the file's own
 *   refreshed state**.
 *
 * ## The write is the whole design
 *
 * A verdict is on disk before it is on the screen. There is no transaction, no
 * working set and no undo: ADR-0015 makes the file append-only precisely so that
 * closing a tab or losing a browser can never cost judgement already made, and a
 * reversal is an appended `none` rather than an edit. That is why the reply
 * carries the resolved file rather than an acknowledgement — the screen's model
 * of what has been decided is always the file's, so there is no second copy to
 * fall out of step with it. `web/tierOverrideFile.ts` owns the append itself,
 * including the repair that stops a row fusing onto an unterminated last line.
 *
 * ## Why this route is dev-only, and structurally so
 *
 * `editorDayPlugin` reads `data/`; this one **writes** it. A route that survived
 * into production would be a path from the public internet into the repository
 * with a file that can never be regenerated at the end of it. Three things make
 * that impossible rather than unlikely: `apply: "serve"` here, `vite.config.ts`
 * naming the build's inputs so `editor.html` is never in a bundle, and no Worker
 * route answering this path. It does not weaken ADR-0013 either: there is no
 * player, no Session and no Submission being adjudicated — a maintainer is
 * editing their own repository over localhost.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parsePrevalenceCsv } from "../src/pipeline.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import { localCalendarDate, parseSchedule, type Schedule } from "../src/schedule.ts";
import { VERDICT_VALUE, type TierOverrideRow } from "../src/tierOverride.ts";
import { readScheduledDay } from "../scripts/editorDay.ts";
import { EDITOR_TIER_PATH } from "./src/endpoints.ts";
import type { DayLists, TierPickerState, TierWriteResult } from "./src/editor/retier.ts";
import { builtIndex, builtKnownnessThreshold } from "./builtIndex.ts";
import { editorDayRequest } from "./editorDayRequest.ts";
import { reachOf, tierPickerState } from "./editorTierPayload.ts";
import { MAX_TIER_BODY_BYTES, tierWriteRequest } from "./editorTierRequest.ts";
import { appendTierOverride, readTierOverrideText } from "./tierOverrideFile.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the handler needs from the world, so the transport can be driven in a
 * test with no dev server, no artifact, no clock and — the one that matters —
 * **no `data/` directory**. Every unit test of this route appends to an array.
 */
export interface EditorTierDeps {
  schedule: () => Schedule;
  /** Passed on unopened: a date outside the run costs no fifteen-megabyte read. */
  openIndex: () => RhymeIndex;
  /** The editor's own calendar date, from which "tomorrow" is taken. */
  today: () => string;
  /** The pinned prevalence norms, parsed and unpatched by any override. */
  measured: () => ReadonlyMap<string, number>;
  /** `data/tier-overrides.csv` as text; empty when no pass has ever written it. */
  overrides: () => string;
  append: (row: TierOverrideRow) => void;
  /** When the judgement was made, as the file records it. */
  now: () => string;
  knownnessThreshold: () => number;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * Read a request body, refusing anything over the cap as the bytes arrive rather
 * than buffering the lot and measuring afterwards. `Content-Length` is an early
 * hint and never a fact — it is the sender's claim about the sender's own body —
 * so an oversize body that declared itself small is caught by the count instead.
 *
 * Resolves the body, or `null` when the request was refused; a `null` means the
 * refusal has already been sent and the caller returns. This is
 * `editorDayPlugin`'s `withinCap` with the body kept: that route has no body to
 * read and only has to decide whether to answer, and collapsing the two into one
 * helper would have handed the read route a buffer it has no use for.
 */
function readCappedBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_TIER_BODY_BYTES) {
    sendJson(res, 413, { error: "That request is too large." });
    return Promise.resolve(null);
  }

  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_TIER_BODY_BYTES) {
        req.destroy();
        sendJson(res, 413, { error: "That request is too large." });
        settle(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(size > MAX_TIER_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")));
    // A connection that broke mid-body is not a request to answer, and the
    // response went with it — settle so nothing is left pending.
    req.on("error", () => settle(null));
  });
}

/**
 * The picker's state for one date, over whatever the file says now.
 *
 * The index is opened only for a date the run covers and could build. A date
 * outside the run still gets the standing verdicts — they are the file's, not
 * the day's — and an empty lemma walk, which is the honest answer to "what does
 * this day's picker need" when there is no day.
 */
function stateFor(deps: EditorTierDeps, date: string): TierPickerState {
  let opened: RhymeIndex | undefined;
  const open = () => (opened ??= deps.openIndex());
  const readout = readScheduledDay(open, deps.schedule(), date);
  const lists: DayLists =
    readout.outcome === "day"
      ? { answers: readout.answers, bonusWords: readout.bonusWords }
      : { answers: [], bonusWords: [] };

  return tierPickerState({
    date,
    lemmaCandidates: (word) => open().derivation.lemmaCandidates(word),
    lists,
    measured: deps.measured(),
    overrides: deps.overrides(),
    knownnessThreshold: deps.knownnessThreshold(),
  });
}

/**
 * The endpoint, apart from the dev server it is mounted on.
 *
 * Every refusal is a status and a sentence, and none of them is `next()`: this
 * path is the editor's alone, and falling through would hand a bad request the
 * static shell's HTML with a 200 on it — the one shape of failure worth ruling
 * out on a route whose success case writes to `data/`.
 *
 * The order of the checks on a write is the order in which each one can rule the
 * write out: the verb, then the size, then the day, then the judgement. Nothing
 * touches the file until all four have passed, which is what "every refusal
 * writes nothing" means and what the suite asserts of each of them in turn.
 */
export function editorTierHandler(deps: EditorTierDeps) {
  // `next` is connect's and is named here only to be visibly never called.
  return (req: IncomingMessage, res: ServerResponse, _next?: () => void): void => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      sendJson(res, 405, { error: "Read the picker with GET, record a judgement with POST." });
      return;
    }

    void (async () => {
      const body = await readCappedBody(req, res);
      if (body === null) return;

      const asked = editorDayRequest(req.url ?? "/", deps.today());
      if (!asked.ok) return sendJson(res, 400, { error: asked.error });

      try {
        if (method === "GET") return sendJson(res, 200, stateFor(deps, asked.date));

        const judgement = tierWriteRequest(body);
        if (!judgement.ok) return sendJson(res, 400, { error: judgement.error });

        sendJson(res, 200, record(deps, judgement.word, judgement.verdict, asked.date));
      } catch (error) {
        // What throws past here is a missing artifact, an unreadable schedule or
        // a file that would not take the append. All three already name their
        // file, so the cause is relayed whole and nothing is added to it — a
        // second sentence guessing at the remedy reads as two diagnoses of one
        // problem. Relaying is safe in a way it would not be on a deployed
        // route: the reader is the maintainer, and the paths are their own.
        sendJson(res, 500, {
          error: `Could not record that judgement: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    })();
  };
}

/**
 * Append one judgement, then answer with what the file now says.
 *
 * `measured` is the word's **own** prevalence row and never the lemma's it tiers
 * on. ADR-0015 reads an empty `measured` as "the word had no prevalence row at
 * all" — a lemmatiser coverage gap, `bolder` and `bussed` — and that is a
 * different population from a genuine disagreement with the data,
 * `counterthrust` at 1.2119. Falling back to the lemma's value would claim the
 * data had measured a word it never saw, and collapse the two populations the
 * file exists to keep apart.
 *
 * The state is read back from the file rather than patched in memory, so what
 * the screen shows next is what a rebuild would read.
 */
function record(
  deps: EditorTierDeps,
  word: string,
  verdict: TierOverrideRow["verdict"],
  date: string,
): TierWriteResult {
  const appended: TierOverrideRow = {
    word,
    verdict,
    measured: deps.measured().get(word) ?? null,
    decided: deps.now(),
    note: "",
  };
  deps.append(appended);

  const state = stateFor(deps, date);
  const standing = new Map(state.standing.map((row) => [row.word, row]));
  const measured = deps.measured();
  // The same rule `applyTierOverrides` applies at build time: a patching verdict
  // plants its sentinel, and a `none` leaves the measurement governing.
  const valueOf = (candidate: string): number | undefined => {
    const standingVerdict = standing.get(candidate)?.verdict;
    if (standingVerdict !== undefined && standingVerdict !== "none") {
      return VERDICT_VALUE[standingVerdict];
    }
    return measured.get(candidate);
  };

  return { state, appended, reach: reachOf(word, deps.openIndex(), valueOf) };
}

/**
 * The reviewed schedule artifact, read per request rather than held — a small
 * hand-edited file, and an editor who has just corrected a day should see the
 * correction on reload rather than after restarting the dev server. Read here
 * rather than through `scripts/editorShell.ts`'s `loadSchedule`, which answers
 * an unreadable artifact with `process.exit(1)`: right for a command, and wrong
 * for a dev server that is also serving the player's shell.
 */
function readSchedule(): Schedule {
  const path = resolve(repoRoot, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) throw new Error(`${path} is not a readable schedule artifact.`);
  return parsed;
}

const overridePath = resolve(repoRoot, "data/tier-overrides.csv");

/**
 * The pinned prevalence norms, parsed once and kept. 62k rows and a few
 * megabytes; they never change under a running dev server, because they are a
 * pinned third-party source rather than anything this tool writes.
 */
let norms: Map<string, number> | undefined;
function measuredPrevalence(): ReadonlyMap<string, number> {
  norms ??= parsePrevalenceCsv(readFileSync(resolve(repoRoot, "data/prevalence.csv"), "utf8"));
  return norms;
}

export function editorTierPlugin(): Plugin {
  return {
    name: "rhyme-bee-editor-tier",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        EDITOR_TIER_PATH,
        editorTierHandler({
          schedule: readSchedule,
          openIndex: builtIndex,
          today: () => localCalendarDate(),
          measured: measuredPrevalence,
          overrides: () => readTierOverrideText(overridePath),
          append: (row) => appendTierOverride(overridePath, row),
          now: () => new Date().toISOString(),
          knownnessThreshold: builtKnownnessThreshold,
        }),
      );
    },
  };
}
