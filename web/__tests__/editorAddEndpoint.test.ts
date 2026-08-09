/**
 * The dev-only endpoint the Editor's Pass submits its add queue through. What an
 * add *means* is `scripts/editorAdd.ts` and is tested in
 * `scripts/__tests__/editorAdd.test.ts`; what the queue does before Submit is
 * `web/__tests__/addQueue.test.ts`. What is tested here is the transport around
 * them — that only the one verb it answers is answered, that a body is capped
 * rather than buffered, that every refusal writes nothing and rebuilds nothing,
 * and that an accepted Submit performs its three acts **in the one order that
 * makes them true**: write, rebuild, then re-read.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost;
 * `web/__tests__/editorDemotionEndpoint.test.ts` is the shape those tests took
 * and the shape these follow.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import type { Schedule } from "../../src/schedule.ts";
import { add, type AddOutcome, type AddTarget } from "../../scripts/editorAdd.ts";
import type { IndexStaleness } from "../../scripts/indexArtifact.ts";
import type { AddSubmitResult, RebuildResult } from "../src/editor/add.ts";
import { MAX_ADD_BODY_BYTES, addWriteRequest } from "../editorAddRequest.ts";
import { editorAddHandler } from "../editorAddPlugin.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Answered {
  status: number;
  headers: Record<string, string>;
  body: string;
  nexted: boolean;
}

/** Call the handler the way connect does, mounted prefix already stripped. */
async function call(
  handler: ReturnType<typeof editorAddHandler>,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Answered> {
  const body = options.body ?? "";
  const req = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as IncomingMessage;
  req.method = options.method ?? "POST";
  req.url = "/";
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

/**
 * One scheduled day, with `bust`'s **real** Rhyme Key on it. Real because the
 * key is what a Submit aims at, and one test below drives the route with the
 * real `add` over the real pinned sources — a key no word could read on would
 * make that test assert about a family that does not exist. Keys carry no
 * stress digits (`rhymeKeyOf`, `src/phonology.ts`), which is why this is
 * `AH S T` and not `AH1 S T`.
 */
const SCHEDULE: Schedule = {
  startDate: "2026-08-10",
  days: [
    {
      date: "2026-08-10",
      weekday: "Mon",
      week: 1,
      seed: "bust",
      rhymeKey: "AH S T",
      answerCount: 20,
      difficulty: 0.3,
    },
  ],
};

/** An outcome shaped like `add`'s, for a batch nothing needed to be done to. */
function outcomeFor(words: string[], aim: AddTarget): AddOutcome {
  return {
    target: aim.target,
    provenance: aim.provenance,
    words: words.map((word) => ({ outcome: "already-reads", word, readings: [] })),
  };
}

/**
 * Enough of a `RhymeIndex` for the endpoint, holding whichever Answers it is
 * given. Typed through `unknown` because the route reaches for exactly the
 * members `readScheduledDay` uses, and standing a real index up here would test
 * `buildPuzzle` rather than the transport — the shape
 * `web/__tests__/editorDayEndpoint.test.ts` established.
 */
function stubIndex(answers: string[]): RhymeIndex {
  return {
    pinSeed: (word: string, rhymeKey?: string) => ({ word, rhymeKey }),
    buildPuzzle: () => ({
      seedRespelling: "BUST",
      answers: answers.map((word) => ({ word, length: word.length, knownness: 0.5 })),
      bonusWords: [],
    }),
    rhymeKeysOf: () => [],
  } as unknown as RhymeIndex;
}

/**
 * The endpoint with the three acts replaced by recorders, so nothing writes to
 * `data/`, no process is spawned and no fifteen-megabyte artifact is opened.
 * `acts` is the order they happened in, which is the property most worth
 * asserting about this route.
 */
function endpoint(
  options: {
    schedule?: () => Schedule;
    runAdds?: (words: string[], aim: AddTarget) => Promise<AddOutcome>;
    rebuild?: () => Promise<RebuildResult>;
    openIndex?: () => RhymeIndex;
    staleness?: () => IndexStaleness;
  } = {},
) {
  const acts: string[] = [];
  const added: { words: string[]; aim: AddTarget }[] = [];
  const handler = editorAddHandler({
    schedule: options.schedule ?? (() => SCHEDULE),
    runAdds:
      options.runAdds ??
      ((words, aim) => {
        acts.push("add");
        added.push({ words, aim });
        return Promise.resolve(outcomeFor(words, aim));
      }),
    rebuild:
      options.rebuild ??
      (() => {
        acts.push("rebuild");
        return Promise.resolve({ ok: true });
      }),
    openIndex:
      options.openIndex ??
      (() => {
        acts.push("open-index");
        // Which Answers the index holds depends on whether the rebuild has run,
        // which is how "re-read from the *fresh* artifact" is asserted below
        // rather than assumed: an index opened before the rebuild reads the day
        // as it was, and would show it here.
        return stubIndex(acts.includes("rebuild") ? ["bust", "adjust"] : ["bust"]);
      }),
    // A current index by default, which is the state in which #161's refusal of
    // an empty batch still stands. The tests that widen it (#162) hand in a
    // stale one, and the act is recorded so "the staleness read happened, and
    // happened before anything else" is assertable rather than assumed.
    staleness:
      options.staleness ??
      (() => {
        acts.push("staleness");
        return { stale: false, reason: null };
      }),
  });
  return { handler, acts, added };
}

const submit = (payload: unknown) => ({ method: "POST", body: JSON.stringify(payload) });
const batch = { date: "2026-08-10", words: ["candleholder"] };

describe("submitting a queue", () => {
  it("aims the words at the day's own Rhyme Key, taken from the schedule", async () => {
    const { handler, added } = endpoint();
    const answered = await call(handler, submit(batch));

    expect(answered.status).toBe(200);
    expect(added).toEqual([
      {
        words: ["candleholder"],
        aim: { target: "AH S T", provenance: "2026-08-10, the bust Puzzle" },
      },
    ]);
  });

  /**
   * The one order in which the three acts are true. A re-read before the
   * rebuild returns the day as it was; a rebuild before the writes folds in
   * nothing. This is the assertion that fails if anyone reorders them for
   * apparent speed.
   */
  it("writes, then rebuilds, then re-reads the day", async () => {
    const { handler, acts } = endpoint();
    await call(handler, submit(batch));

    expect(acts).toEqual(["add", "rebuild", "open-index"]);
  });

  it("answers with what became of each word", async () => {
    const { handler } = endpoint();
    const answered = await call(handler, submit({ date: "2026-08-10", words: ["one", "two"] }));
    const result = JSON.parse(answered.body) as AddSubmitResult;

    expect(result.rebuilt).toEqual({ ok: true });
    expect(result.outcome!.target).toBe("AH S T");
    expect(result.outcome!.words.map((word) => word.word)).toEqual(["one", "two"]);
  });

  /**
   * The failure this route is most likely to have and least likely to notice: a
   * day re-read from the index the process had already parsed would carry the
   * figures from before the adds and look entirely plausible. The stub index
   * answers differently once the rebuild has run, so a re-read taken too early
   * shows up as the *old* Answer list rather than as an error.
   *
   * In the dev server the same guarantee is `forgetBuiltIndex`, which
   * `rebuildIndex` calls on success — see `web/builtIndex.ts`.
   */
  it("re-reads the day from the index as it stands after the rebuild", async () => {
    const { handler } = endpoint();
    const result = JSON.parse((await call(handler, submit(batch))).body) as AddSubmitResult;

    expect(result.readout).not.toBeNull();
    expect(result.readout!.outcome).toBe("day");
    const day = result.readout as Extract<typeof result.readout, { outcome: "day" }>;
    expect(day.answers.map((answer) => answer.word)).toEqual(["bust", "adjust"]);
    expect(day.facts.answerCount).toBe(2);
  });

  it("normalises the words before they are judged", async () => {
    const { handler, added } = endpoint();
    await call(handler, submit({ date: "2026-08-10", words: ["  CandleHolder "] }));

    expect(added[0]!.words).toEqual(["candleholder"]);
  });

  /**
   * A rebuild that failed leaves the artifact as it was, so the day would be
   * re-read from an index that predates the adds. That re-read is withheld —
   * `null` — rather than shown with a caveat on it, for the reason
   * `DayReadoutView` withholds a band verdict it can no longer vouch for: a
   * stale figure displayed as a current one is the failure this route exists to
   * avoid.
   */
  it("withholds the re-read when the rebuild failed, and still reports the writes", async () => {
    const { handler, acts } = endpoint({
      rebuild: () => {
        acts.push("rebuild");
        return Promise.resolve({ ok: false, error: "npm run build:index exited 1." });
      },
    });
    const answered = await call(handler, submit(batch));
    const result = JSON.parse(answered.body) as AddSubmitResult;

    expect(answered.status).toBe(200);
    expect(result.rebuilt).toEqual({ ok: false, error: "npm run build:index exited 1." });
    expect(result.readout).toBeNull();
    expect(result.outcome!.words).toHaveLength(1);
    // The index is never opened, because there is no fresh artifact to open.
    expect(acts).toEqual(["add", "rebuild"]);
  });

  /**
   * An artifact that was rebuilt and then would not open is not a failed
   * Submit: the readings are on disk and the index is built. The readout is
   * dropped and the outcome kept, because the outcome is the part the editor
   * cannot reconstruct by reloading.
   */
  it("keeps the outcome when the day itself will not read back", async () => {
    const { handler } = endpoint({
      openIndex: () => {
        throw new Error("No built Rhyme Index in /repo/dist-data.");
      },
    });
    const answered = await call(handler, submit(batch));
    const result = JSON.parse(answered.body) as AddSubmitResult;

    expect(answered.status).toBe(200);
    expect(result.readout).toBeNull();
    expect(result.rebuilt).toEqual({ ok: true });
    expect(result.outcome!.words).toHaveLength(1);
  });
});

/**
 * #161: "Submit writes no Tier verdict and no demotion: those are already on
 * disk." The claim is held to account against the real files rather than left to
 * a comment — a Tier verdict can never be regenerated (ADR-0015), and a demotion
 * written by a route nobody asked to write one would take a word out of every
 * Puzzle.
 *
 * Two assertions, because they fail for different reasons and one of them alone
 * would overstate what is proved.
 *
 * The **first** drives the handler with `runAdds` stubbed. What it can catch is a
 * write folded into the *route* — which is where a later slice would plausibly
 * put one, since the route is the thing that already knows the date and the
 * word. What it cannot catch is a write folded into `add`, because `add` is not
 * running.
 *
 * The **second** closes that by handing the route the real `add`, pinned sources
 * and all. It submits a word CMUdict already reads on the day's Rhyme Key, so
 * the outcome is `already-reads` and the honest expectation is that *nothing*
 * anywhere under `data/` moves — which is why the watch list widens to `add`'s
 * own two write targets as well. Deliberately not a word that would be written:
 * appending to `data/supplement.dict` inside the suite to prove a point about
 * two other files means a run interrupted between the write and the restore
 * leaves a committed source dirty, and a word no compound split reaches would
 * additionally spawn the `claude` CLI and wait a minute on it. So what remains
 * unproved by test, and rests on `EditorAddDeps` instead, is `applyAddOutcome`'s
 * append path. That surface is the real enforcement: `add` is handed `words` and
 * an `AddTarget` and hands back an `AddOutcome`, and there is no Tier or
 * demotion in either direction.
 */
/**
 * #162: "Submit is enabled by a stale index as well as by a queued add", and
 * "submitting with no queued adds rebuilds and re-reads without writing
 * anything new."
 *
 * The second claim is the one worth being careful about, and it is held to
 * account twice below for the reason #161's equivalent claim is: an assertion
 * that only ever runs against stubbed deps proves that *this handler* did not
 * write, and says nothing about what the functions it calls would have done.
 * Here the two are `acts` — which proves `runAdds` was never entered at all,
 * so there is no write path to reason about — and a byte-for-byte snapshot of
 * every file the pass can write, taken across the real call.
 */
describe("submitting with nothing queued", () => {
  const stale: IndexStaleness = {
    stale: true,
    reason: "input-newer",
    input: resolve(repoRoot, "data/tier-overrides.csv"),
  };

  it("rebuilds and re-reads when rows have been written since the last build", async () => {
    const { handler, acts } = endpoint({ staleness: () => stale });
    const answered = await call(handler, submit({ date: "2026-08-10", words: [] }));
    const result = JSON.parse(answered.body) as AddSubmitResult;

    expect(answered.status).toBe(200);
    // No `add`. The one function in this handler that can write to `data/` is
    // never entered, which is what makes "writes nothing new" structural rather
    // than a property of `add` being well behaved when handed no words.
    expect(acts).toEqual(["rebuild", "open-index"]);
    expect(result.rebuilt).toEqual({ ok: true });
    expect(result.readout).not.toBeNull();
  });

  /**
   * Null, not an `AddOutcome` with an empty word list. The two render as the
   * same counts and are different facts — "nothing was submitted" against
   * "every word submitted was already known" — and the screen says a different
   * sentence for each.
   */
  it("answers with no outcome at all, rather than an empty one", async () => {
    const { handler } = endpoint({ staleness: () => stale });
    const result = JSON.parse(
      (await call(handler, submit({ date: "2026-08-10", words: [] }))).body,
    ) as AddSubmitResult;

    expect(result.outcome).toBeNull();
  });

  /**
   * The claim, against the files rather than against a comment. Every path the
   * pass can write is snapshotted by contents *and* mtime, so a rewrite with
   * identical bytes would still fail this.
   */
  it("leaves every file the pass writes byte-identical", async () => {
    const watched = [
      "data/tier-overrides.csv",
      "data/demotions.txt",
      "data/supplement.dict",
      "data/deferred-readings.jsonl",
      // Never written by anything in the pass, and named here because that is
      // the one guarantee worth restating: the reviewed schedule artifact is
      // hand-edited and is not this tool's to touch.
      "data/schedule.json",
    ].map((name) => resolve(repoRoot, name));
    const snapshot = () =>
      watched.map((path) =>
        existsSync(path)
          ? { path, text: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs }
          : { path, text: null, mtimeMs: null },
      );

    const before = snapshot();
    // `runAdds` is the real `add`, so a handler that decided to call it with an
    // empty batch would be running the writing code rather than a recorder.
    const { handler, acts } = endpoint({ staleness: () => stale, runAdds: add });
    const answered = await call(handler, submit({ date: "2026-08-10", words: [] }));

    expect(answered.status).toBe(200);
    expect(acts).toEqual(["rebuild", "open-index"]);
    expect(snapshot()).toEqual(before);
  });

  /**
   * A day is not resolved for an empty batch, so the schedule is never read —
   * there is no Rhyme Key to aim nothing at. Asserted because the alternative
   * shape (resolve the aim, then skip the add) reads almost identically and
   * would make an unreadable schedule fail a Submit that needs nothing from it.
   */
  it("does not consult the schedule, having nothing to aim", async () => {
    const { handler } = endpoint({
      staleness: () => stale,
      schedule: () => {
        throw new Error("data/schedule.json is not a readable schedule artifact.");
      },
    });
    const answered = await call(handler, submit({ date: "2026-08-10", words: [] }));

    // The re-read still asks for the schedule and still fails, which `readDay`
    // answers with a null readout rather than a failed Submit — the rebuild it
    // was pressed for did happen.
    expect(answered.status).toBe(200);
    const result = JSON.parse(answered.body) as AddSubmitResult;
    expect(result.rebuilt).toEqual({ ok: true });
    expect(result.readout).toBeNull();
  });
});

describe("what Submit does not write", () => {
  const paths = (names: string[]) => names.map((name) => resolve(repoRoot, name));
  const verdicts = paths(["data/tier-overrides.csv", "data/demotions.txt"]);
  const addsOwn = paths(["data/supplement.dict", "data/deferred-readings.jsonl"]);

  /** A file's contents and mtime, or its absence — both count as unchanged. */
  const snapshot = (watched: string[]) =>
    watched.map((path) =>
      existsSync(path)
        ? { path, text: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs }
        : { path, text: null, mtimeMs: null },
    );

  it("leaves data/tier-overrides.csv and data/demotions.txt untouched", async () => {
    const before = snapshot(verdicts);
    const { handler } = endpoint();
    const answered = await call(handler, submit(batch));

    expect(answered.status).toBe(200);
    expect(snapshot(verdicts)).toEqual(before);
  });

  it("leaves them untouched across a real add, which is the call that could write", async () => {
    const watched = [...verdicts, ...addsOwn];
    const before = snapshot(watched);
    // `rebuild` and `openIndex` stay recorders: a real rebuild is a subprocess
    // and a real index is fifteen megabytes, and neither is what this asserts.
    const { handler } = endpoint({ runAdds: add });
    const answered = await call(handler, submit({ date: "2026-08-10", words: ["adjust"] }));

    expect(answered.status).toBe(200);
    const result = JSON.parse(answered.body) as AddSubmitResult;
    // Held to `already-reads` on purpose. If CMUdict ever stopped reading
    // `adjust` on this key the word would be *written*, and the assertion below
    // would then be passing for a reason this test never intended.
    expect(result.outcome!.words.map((word) => word.outcome)).toEqual(["already-reads"]);
    expect(snapshot(watched)).toEqual(before);
  });
});

describe("what the endpoint refuses, and writes nothing for", () => {
  it("answers anything but POST with a method refusal", async () => {
    const { handler, acts } = endpoint();
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, { ...submit(batch), method });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("POST");
      expect(answered.nexted).toBe(false);
    }
    expect(acts).toEqual([]);
  });

  it("refuses a body over the cap", async () => {
    const { handler, acts } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_ADD_BODY_BYTES + 1),
    });

    expect(answered.status).toBe(413);
    expect(acts).toEqual([]);
  });

  it("refuses an oversize body that declared itself small", async () => {
    const { handler, acts } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      body: "x".repeat(MAX_ADD_BODY_BYTES + 1),
      headers: { "content-length": "42" },
    });

    expect(answered.status).toBe(413);
    expect(acts).toEqual([]);
  });

  it("refuses a declared size over the cap before a byte of it arrives", async () => {
    const { handler, acts } = endpoint();
    const answered = await call(handler, {
      method: "POST",
      headers: { "content-length": String(MAX_ADD_BODY_BYTES + 1) },
    });

    expect(answered.status).toBe(413);
    expect(acts).toEqual([]);
  });

  it("refuses a body that is not a batch of adds, and names what was wrong", async () => {
    const { handler, acts } = endpoint();
    const bodies: [string, RegExp][] = [
      ["not json at all", /batch of adds/i],
      [JSON.stringify({ words: ["bust"] }), /date/i],
      [JSON.stringify({ date: "10-08-2026", words: ["bust"] }), /date/i],
      [JSON.stringify({ date: "2026-08-10" }), /words/i],
      [JSON.stringify({ date: "2026-08-10", words: "bust" }), /words/i],
      [JSON.stringify({ date: "2026-08-10", words: ["bust", 7] }), /words/i],
      [JSON.stringify({ date: "2026-08-10", words: ["counter-thrust"] }), /not a word/i],
      [JSON.stringify({ date: "2026-08-10", words: ["bust", "BUST"] }), /same word twice/i],
    ];
    for (const [body, expected] of bodies) {
      const answered = await call(handler, { method: "POST", body });

      expect(answered.status).toBe(400);
      expect(JSON.parse(answered.body).error).toMatch(expected);
    }
    expect(acts).toEqual([]);
  });

  /**
   * #161 refused every empty batch; #162 refuses only the ones with nothing
   * behind them. With the artifact holding everything on disk there is nothing
   * for a rebuild to fold in, and the whole rebuild is what an empty Submit
   * would cost — so the refusal stands, and the staleness read is the only act
   * that ran.
   */
  it("refuses an empty batch when the index already holds everything on disk", async () => {
    const { handler, acts } = endpoint();
    const answered = await call(handler, submit({ date: "2026-08-10", words: [] }));

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toMatch(/Nothing is pending/);
    expect(acts).toEqual(["staleness"]);
  });

  /**
   * A staleness read that threw has not answered, and the refusal above is the
   * only thing between an empty Submit and a rebuild for nothing — so it is
   * taken. The sentence names no path: the causes here are absolute paths under
   * `dist-data/`, and this route's neighbours relay theirs on an argument
   * ("the reader is the maintainer") that #162's own criterion overrides.
   */
  it("refuses an empty batch it could not decide about, naming no path", async () => {
    const { handler, acts } = endpoint({
      staleness: () => {
        acts.push("staleness");
        throw new Error("EPERM: operation not permitted, stat 'C:\\\\Users\\\\someone\\\\dist-data'");
      },
    });
    const answered = await call(handler, submit({ date: "2026-08-10", words: [] }));

    expect(answered.status).toBe(500);
    const { error } = JSON.parse(answered.body) as { error: string };
    expect(error).toMatch(/nothing was rebuilt/i);
    expect(error).not.toMatch(/EPERM|Users|dist-data\b.*stat/);
    expect(acts).toEqual(["staleness"]);
  });

  it("refuses a date the run does not cover, since there is no key to aim at", async () => {
    const { handler, acts } = endpoint();
    const answered = await call(handler, submit({ date: "2030-01-01", words: ["bust"] }));

    expect(answered.status).toBe(400);
    expect(JSON.parse(answered.body).error).toMatch(/No Daily Puzzle is scheduled for 2030-01-01/);
    expect(acts).toEqual([]);
  });

  it("relays a schedule it could not read, rather than adding against nothing", async () => {
    const { handler, acts } = endpoint({
      schedule: () => {
        throw new Error("data/schedule.json is not a readable schedule artifact.");
      },
    });
    const answered = await call(handler, submit(batch));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toMatch(/schedule.json/);
    expect(acts).toEqual([]);
  });

  /**
   * A batch that threw is a batch whose writes are in an unknown state, and the
   * screen must not show it as made. The failure is relayed whole for the reason
   * the Tier and demotion routes relay theirs: the reader is the maintainer, and
   * the paths are their own.
   */
  it("relays a failed add, and does not rebuild over it", async () => {
    const { handler, acts } = endpoint({
      runAdds: () => {
        acts.push("add");
        return Promise.reject(new Error("EACCES: permission denied, open '/repo/data/supplement.dict'"));
      },
    });
    const answered = await call(handler, submit(batch));

    expect(answered.status).toBe(500);
    expect(JSON.parse(answered.body).error).toContain("EACCES");
    expect(acts).toEqual(["add"]);
  });
});

describe("what counts as a Submit", () => {
  it("takes a day and a list of words, normalised", () => {
    expect(addWriteRequest(JSON.stringify({ date: "2026-08-10", words: [" Bust "] }))).toEqual({
      ok: true,
      date: "2026-08-10",
      words: ["bust"],
    });
  });

  /**
   * The cap is stated in words rather than bytes because the binding cost is
   * time: a word no compound split reaches waits on an agent for up to a minute,
   * and those waits are serial.
   */
  /**
   * An empty list parses, where #161 refused it here. The decision moved to the
   * endpoint because it is a question about the disk — is anything pending? —
   * and this module reads no files, which is the whole reason it can be tested
   * without a repository around it.
   */
  it("takes an empty list, leaving whether it means anything to the endpoint", () => {
    expect(addWriteRequest(JSON.stringify({ date: "2026-08-10", words: [] }))).toEqual({
      ok: true,
      date: "2026-08-10",
      words: [],
    });
  });

  it("refuses more words than one Submit carries", () => {
    const words = Array.from({ length: 51 }, (_, n) => "w" + "a".repeat(n + 1));
    const asked = addWriteRequest(JSON.stringify({ date: "2026-08-10", words }));

    expect(asked.ok).toBe(false);
    expect(asked.ok === false && asked.error).toMatch(/one Submit carries 50/);
  });
});
