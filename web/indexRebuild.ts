/**
 * Rebuilding the Rhyme Index from the browser — the middle third of Submit
 * (#161), between the writes `add` performs and the re-read of the day.
 *
 * ## Why a subprocess rather than an in-process build
 *
 * `scripts/build-index.ts` is a script, not a function: it reads the pinned
 * sources, manufactures the index and writes the artifact at module scope, so
 * importing it once would build once and importing it again would be a cache
 * hit that built nothing. Making it a function to call from here would be a
 * second definition of what a rebuild is, in a repository whose whole answer to
 * "which judge is the player running" is that there is exactly one artifact and
 * one command that writes it.
 *
 * Running the documented command instead keeps that single definition. It also
 * keeps fifteen megabytes of intermediate index out of the dev server's heap —
 * which is already holding a parsed copy for the editor's own screen — and it
 * means a build that throws takes a child process down rather than the server
 * the maintainer is working in.
 *
 * The cost is a process start, and the whole rebuild was measured at **2.4
 * seconds** on the maintainer's machine (133,523 pronunciations, 370,079
 * words). That figure is what makes rebuild-on-Submit an act rather than an
 * interruption; the "four minutes" some older comments quote is stale (#152).
 *
 * ## Why `npm run build:index` and not `tsx` directly
 *
 * The same reason: `package.json` is where the command is named, and the editor
 * pressing Submit should run the command the documentation tells them to run.
 * `shell: true` is what lets `npm` be found on Windows, where it is a `.cmd`
 * shim — the same accommodation `authorWithAgent` (`scripts/editorAdd.ts`)
 * makes, for the same reason. There is nothing caller-supplied in the argv, so
 * the shell has nothing to interpolate.
 *
 * ## Why the cache is forgotten here
 *
 * Because a rebuild that left `builtIndex`'s copy standing is the one failure
 * in this whole route that *looks like success*: the day would be re-read from
 * the artifact as it was before the adds and every figure would be plausible.
 * Pairing the two here means no caller can perform half of a rebuild — the
 * endpoint asks for one act and gets one.
 */

import { spawn } from "node:child_process";
import { forgetBuiltIndex } from "./builtIndex.ts";
import type { RebuildResult } from "./src/editor/add.ts";

/**
 * How long the build gets before it is abandoned.
 *
 * Measured at 2.4 seconds, so five minutes is not a guess at the duration — it
 * is the answer to a build that is not going to finish at all, and it errs long
 * for the same reason the agent timeout does: too short abandons a build that
 * would have succeeded and leaves the artifact half-written, which is worse
 * than any amount of waiting.
 */
const REBUILD_TIMEOUT_MS = 5 * 60_000;

/**
 * Run `npm run build:index` and forget the loaded index, so the next read comes
 * off the new artifact.
 *
 * Never throws: a build that failed is a thing the editor needs *told*, beside
 * a readout of the words that were nevertheless written, rather than an
 * exception that loses both. The failure carries the build's own output because
 * that output names the input it choked on, and the reader is the maintainer
 * looking at their own repository.
 *
 * The cache is forgotten only on success. A failed build leaves the previous
 * artifact standing — `writeIndexArtifact` sweeps superseded indexes only after
 * writing the new one — so the copy in memory is still that artifact, and
 * dropping it would buy a needless half-second re-parse of the same bytes.
 */
export function rebuildIndex(root: string): Promise<RebuildResult> {
  return new Promise((settle) => {
    const child = spawn("npm", ["run", "build:index"], { cwd: root, shell: true });
    let output = "";
    let settled = false;
    const done = (result: RebuildResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.ok) forgetBuiltIndex();
      settle(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      done({
        ok: false,
        error: `npm run build:index did not finish within ${REBUILD_TIMEOUT_MS / 60_000} minutes.`,
      });
    }, REBUILD_TIMEOUT_MS);

    // Both streams, because a build failure announces itself on stderr and the
    // line that says which input broke is often the last thing on stdout.
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (cause) => done({ ok: false, error: `${cause.message}` }));
    child.on("close", (code) =>
      done(
        code === 0
          ? { ok: true }
          : { ok: false, error: `npm run build:index exited ${code}.\n${tail(output)}` },
      ),
    );
  });
}

/**
 * The end of the build's output, which is where a failure says what it was.
 * Bounded because this reaches a browser and a stack trace over a 370,000-word
 * input can be long; the last twenty lines have carried every real build
 * failure this project has had.
 */
function tail(output: string): string {
  return output.split(/\r?\n/).slice(-20).join("\n").trim();
}
