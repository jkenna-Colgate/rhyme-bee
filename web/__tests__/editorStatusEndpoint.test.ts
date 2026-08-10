/**
 * The dev-only endpoint the Editor's Pass reads its own state through (#162).
 * What the status *means* is `web/editorStatusReport.ts` and `status.ts`, and
 * is tested in `web/__tests__/editorStatus.test.ts`. What is tested here is the
 * transport around them — and above all that **nothing about the environment
 * reaches the response**, which is the acceptance criterion this route is most
 * able to break: it handles absolute paths by design and shells out to `git`,
 * whose failures quote both.
 *
 * The socket ceremony this route shares with the other four — the body cap, and
 * that no path falls through — is `web/editorRoute.ts`'s and is tested in
 * `editorRoute.test.ts`. What stays here is this route's own 405 *sentence*,
 * and the claim that a refusal asks git and the artifact nothing.
 *
 * The last describe drives the real `git`, against a repository built in a temp
 * directory for the purpose. It is the only way to hold `uncommittedPorcelain`
 * to account — a parser tested only against strings a test wrote is a parser
 * tested against one person's memory of what `git status` prints — and it stays
 * well away from the maintainer's own tree, which this tool must never write to
 * and which a test must never depend on the state of.
 *
 * `AGENTS.md` records that the Worker routes were tested despite a convention
 * calling transport untested, and that the convention lost;
 * `web/__tests__/editorAddEndpoint.test.ts` is the shape those tests took and
 * the shape these follow.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IndexStaleness } from "../../scripts/indexArtifact.ts";
import { editorStatusSpec } from "../editorStatusPlugin.ts";
import { editorMiddleware } from "../editorRoute.ts";
import { callRoute as call } from "./routeCall.ts";
import { porcelainCodes, writtenStatus } from "../editorStatusReport.ts";
import { WRITTEN_FILES, type EditorStatus } from "../src/editor/status.ts";
import { uncommittedPorcelain } from "../workingTree.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");


/**
 * The endpoint with both reads replaced by recorders, so no artifact is stat-ed
 * and no subprocess is spawned. `asks` is what it consulted, which is how "this
 * route reads and writes nothing" is asserted rather than asserted about.
 */
function endpoint(
  options: {
    staleness?: () => IndexStaleness;
    porcelain?: () => Promise<string | null>;
    present?: () => ReadonlySet<string>;
  } = {},
) {
  const asks: string[] = [];
  const handler = editorMiddleware(
    editorStatusSpec({
      staleness:
        options.staleness ??
        (() => {
          asks.push("staleness");
          return { stale: false, reason: null };
        }),
      porcelain:
        options.porcelain ??
        (() => {
          asks.push("porcelain");
          return Promise.resolve("");
        }),
      present:
        options.present ??
        (() => {
          asks.push("present");
          return new Set(WRITTEN_FILES);
        }),
    }),
  );
  return { handler, asks };
}

describe("reading the status", () => {
  it("answers both halves: the index, and every written file", async () => {
    const answered = await call(endpoint().handler);
    const status = JSON.parse(answered.body) as EditorStatus;

    expect(answered.status).toBe(200);
    expect(status.index).toEqual({ stale: false, reason: null, input: null });
    expect(status.written.map((file) => file.path)).toEqual([...WRITTEN_FILES]);
    expect(status.written.every((file) => file.state === "clean")).toBe(true);
  });

  /**
   * The path that makes the widened Submit fire. A Tier verdict appended to
   * `data/tier-overrides.csv` is an input newer than the artifact, and
   * `indexStaleness` says so — `tier-overrides.csv` is exempt from the
   * *missing*-is-stale branch (`OPTIONAL_DATA_INPUTS`) and fully subject to the
   * newer-than branch, which is exactly the pair this screen needs.
   */
  it("reports a stale index, naming the input relative to the repo", async () => {
    const { handler } = endpoint({
      staleness: () => ({
        stale: true,
        reason: "input-newer",
        input: resolve(repoRoot, "data/tier-overrides.csv"),
      }),
    });
    const status = JSON.parse((await call(handler)).body) as EditorStatus;

    expect(status.index).toEqual({
      stale: true,
      reason: "input-newer",
      input: "data/tier-overrides.csv",
    });
  });

  /**
   * "The index is stale" and "the index was never built" are different states
   * with different remedies — Submit can fold rows into an artifact and cannot
   * conjure one — so the reason travels rather than just the flag.
   */
  it("keeps a repository with no artifact distinct from a stale one", async () => {
    const { handler } = endpoint({ staleness: () => ({ stale: true, reason: "no-artifact" }) });
    const status = JSON.parse((await call(handler)).body) as EditorStatus;

    expect(status.index).toEqual({ stale: true, reason: "no-artifact", input: null });
  });

  it("reports every file as unknown when git could not be asked", async () => {
    const { handler } = endpoint({ porcelain: () => Promise.resolve(null) });
    const status = JSON.parse((await call(handler)).body) as EditorStatus;

    expect(status.written.map((file) => file.state)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });
});

/**
 * #162's last two criteria, held to account rather than asserted in a comment:
 * "no deploy button, no commit, and no git operation anywhere in the tool", and
 * "nothing about the environment leaks into a response".
 *
 * The reading taken of the first is that the ban is on **mutating** git — the
 * ticket's own body says "The editor does not deploy and does not commit" — and
 * `web/workingTree.ts` argues it at length. What can be tested here is the
 * half that is testable: this handler consults two readers and calls nothing
 * else, on any path.
 */
describe("what the endpoint will not do or say", () => {
  // The mechanism is `web/editorRoute.ts`'s and is tested there. The sentence
  // is this route's own — it says the status changes nothing, which is #162's
  // whole position on this screen — and so is "a refusal asks git nothing".
  it("answers anything but GET with this route's own refusal, and asks nothing", async () => {
    const { handler, asks } = endpoint();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const answered = await call(handler, { method });

      expect(answered.status).toBe(405);
      expect(answered.headers["Allow"]).toBe("GET");
      expect(JSON.parse(answered.body)).toEqual({
        error: "Read the status with GET. It changes nothing.",
      });
      expect(answered.nexted).toBe(false);
    }
    expect(asks).toEqual([]);
  });

  it("asks git and the artifact nothing when the body was refused", async () => {
    const { handler, asks } = endpoint();
    const answered = await call(handler, { headers: { "content-length": "99999" } });

    expect(answered.status).toBe(413);
    expect(asks).toEqual([]);
  });

  /**
   * A staleness read that threw has not answered, and the sentence names no
   * path, no command and no cause. The other four editor routes relay a cause
   * whole on the argument that the reader is the maintainer and the paths are
   * their own; that argument still holds, and #162's own criterion overrides it
   * for this route, whose causes are uniquely bad carriers.
   */
  it("says nothing about the machine when the staleness read throws", async () => {
    const { handler } = endpoint({
      staleness: () => {
        throw new Error(`ENOENT: no such file or directory, open '${repoRoot}/dist-data/x.json'`);
      },
    });
    const answered = await call(handler);
    const { error } = JSON.parse(answered.body) as { error: string };

    expect(answered.status).toBe(500);
    expect(error).toMatch(/status could not be read/i);
    expect(error).not.toContain(repoRoot);
    expect(error).not.toMatch(/ENOENT/);
  });

  /**
   * The response as a whole, swept for the four things that count as a leak:
   * an absolute path, the repo root, the developer's home directory and a
   * Windows drive letter. Swept over the serialised body rather than field by
   * field, because a leak arrives in whichever field nobody thought to check.
   */
  it("carries no absolute path anywhere in a successful response", async () => {
    const { handler } = endpoint({
      staleness: () => ({
        stale: true,
        reason: "missing-input",
        input: resolve(repoRoot, "data/words.txt"),
      }),
      porcelain: () => Promise.resolve(" M data/demotions.txt\n!! data/tier-overrides.csv\n"),
    });
    const answered = await call(handler);

    expect(answered.status).toBe(200);
    expect(answered.body).not.toContain(repoRoot);
    expect(answered.body).not.toContain(tmpdir());
    // A drive letter or a leading slash on any path in the body. `data/...` is
    // what should be there, and neither shape can reach it.
    expect(answered.body).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(answered.body).not.toMatch(/"[\\/]/);
  });
});

/**
 * The real `git`, against a repository built for the purpose.
 *
 * Every mutating command below runs inside a temp directory this test created.
 * Nothing here touches the repository the suite is running in — the tool under
 * test never runs a mutating git command at all, and a test that proved the
 * read by dirtying the maintainer's tree would be a worse citizen than the code
 * it was checking.
 *
 * `-c commit.gpgsign=false` is not a convention this repository bypasses
 * lightly; it is here because a signing prompt in a throwaway repository would
 * hang the suite on any machine configured to sign, waiting for a passphrase
 * nobody is there to type.
 */
describe("what git actually says, over a repository built to say it", () => {
  function scratchRepo(): string {
    const root = mkdtempSync(resolve(tmpdir(), "rhyme-bee-status-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });

    git("init", "--quiet");
    git("config", "user.email", "editor@example.invalid");
    git("config", "user.name", "The Editor");

    mkdirSync(resolve(root, "data"));
    // The repository's own rule, which is what put `data/tier-overrides.csv`
    // out of git's sight until #162 amended it.
    writeFileSync(resolve(root, ".gitignore"), "*.csv\n");
    writeFileSync(resolve(root, "data/demotions.txt"), "kate proper-noun\n");
    writeFileSync(resolve(root, "data/supplement.dict"), "bust B AH1 S T\n");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "the pass so far");
    return root;
  }

  /**
   * The three steps the plugin composes — ask git, parse, decide — over a real
   * repository. The plugin's own wiring is the same three calls in the same
   * order, which is what makes this a test of the route and not of a fixture.
   */
  async function statesIn(root: string): Promise<Record<string, string>> {
    const output = await uncommittedPorcelain(root, WRITTEN_FILES);
    const present = new Set(WRITTEN_FILES.filter((path) => existsSync(resolve(root, path))));
    const statuses = writtenStatus(output === null ? null : porcelainCodes(output), present);
    return Object.fromEntries(statuses.map((file) => [file.path, file.state]));
  }

  it("tells a committed file from one with rows written since", async () => {
    const root = scratchRepo();

    expect(await statesIn(root)).toMatchObject({
      "data/demotions.txt": "clean",
      "data/supplement.dict": "clean",
      // Never written by this pass, so absent rather than a problem.
      "data/deferred-readings.jsonl": "absent",
    });

    writeFileSync(resolve(root, "data/demotions.txt"), "kate proper-noun\nnigel proper-noun\n");
    writeFileSync(resolve(root, "data/deferred-readings.jsonl"), '{"word":"earache"}\n');

    expect(await statesIn(root)).toMatchObject({
      "data/demotions.txt": "uncommitted",
      "data/deferred-readings.jsonl": "uncommitted",
      "data/supplement.dict": "clean",
    });
  });

  /**
   * The defect #162 turned up, reproduced. A blanket `*.csv` rule takes the one
   * file in the project that can never be regenerated (ADR-0015) out of git's
   * sight entirely, so a night of Retrieval judgements is uncommittable and
   * every `git add` the maintainer types succeeds at doing nothing. Reported as
   * its own state rather than as "clean", which is what a status readout that
   * only knew about porcelain lines would have said.
   */
  it("reports a file its ignore rules hide, rather than calling it committed", async () => {
    const root = scratchRepo();
    writeFileSync(resolve(root, "data/tier-overrides.csv"), "counterthrust,bonus\n");

    expect((await statesIn(root))["data/tier-overrides.csv"]).toBe("ignored");
  });

  /** With the rule amended, as `.gitignore` now is, the same file is ordinary. */
  it("reports the same file as uncommitted once the ignore rule exempts it", async () => {
    const root = scratchRepo();
    writeFileSync(resolve(root, ".gitignore"), "*.csv\n!/data/tier-overrides.csv\n");
    writeFileSync(resolve(root, "data/tier-overrides.csv"), "counterthrust,bonus\n");

    expect((await statesIn(root))["data/tier-overrides.csv"]).toBe("uncommitted");
  });

  /**
   * A directory that is not a repository. git exits non-zero with a message
   * quoting the whole parent chain, and none of it is returned — the caller
   * gets the one bit it can act on, and `writtenStatus` turns that into a state
   * the screen says out loud.
   */
  it("answers null where there is no repository, rather than a message about the machine", async () => {
    const outside = mkdtempSync(resolve(tmpdir(), "rhyme-bee-nogit-"));

    expect(await uncommittedPorcelain(outside, WRITTEN_FILES)).toBeNull();
  });
});
