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
 * words — the wordhood set the build ends with, which is 26 short of the
 * 370,105 lines `data/words.txt` holds because `data/demotions.txt` takes that
 * many out. The two figures are both right and are not interchangeable: the
 * request modules and `web/src/editor/add.ts` quote 370,105, because what they
 * bound is the shape of a word in that file, and this quotes what the build
 * came out with.) That 2.4 seconds is what makes rebuild-on-Submit an act
 * rather than an interruption; the "four minutes" some older comments quote is
 * stale (#152).
 *
 * ## Why `npm run build:index` and not `tsx` directly
 *
 * The same reason: `package.json` is where the command is named, and the editor
 * pressing Submit should run the command the documentation tells them to run.
 * `shell: true` is what lets `npm` be found on Windows, where it is a `.cmd`
 * shim — the same accommodation `authorWithAgent` (`scripts/editorAdd.ts`)
 * makes, for the same reason, and it carries the same consequence: the child
 * this module holds is the shell, not the build, so an abandoned rebuild is
 * ended with `killTree` (`web/killTree.ts`) rather than a bare `kill` that
 * would leave the build running under a shell nobody is holding any more. There is
 * nothing caller-supplied in the argv, so the shell has nothing to interpolate.
 *
 * ## Why the cache is forgotten here
 *
 * Because a rebuild that left `builtIndex`'s copy standing is the one failure
 * in this whole route that *looks like success*: the day would be re-read from
 * the artifact as it was before the adds and every figure would be plausible.
 * Pairing the two here means no caller can perform half of a rebuild — the
 * endpoint asks for one act and gets one.
 *
 * ## Why the pairing is built rather than written straight down
 *
 * That guarantee — forgotten on every outcome — was held by nothing but the
 * code below, because nothing could reach the code below: it opened a real
 * subprocess against the real cache. `makeRebuild` takes the four things that
 * made it unreachable, and `rebuildIndex` is one instance of it holding the
 * four the dev server wants. The live path is that construction, not a
 * fallback around it.
 *
 * `spawn` and `kill` are separate deps because `killTree` runs a real
 * `taskkill /pid <n> /f /t` on win32, which is the maintainer's platform: a
 * test driving the timeout with a fabricated child would fire a real kill at a
 * fabricated pid, so the abandon path could not be reached at all. Folding
 * spawn, argv, `shell: true` and the kill into one injectable `startBuild`
 * would be a narrower seam, but it would push `killTree` and the shell
 * reasoning *behind* it and back out of reach.
 *
 * `timeoutMs` is a dep for the same reason and not a fake timer: this suite
 * has no fake timers anywhere, and five minutes cannot be waited out.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  builtIndex,
  builtKnownnessThreshold,
  forgetBuiltIndex,
  type IndexCache,
} from "./builtIndex.ts";
import { killTree } from "./killTree.ts";
import type { RebuildResult } from "./src/editor/add.ts";

export interface RebuildDeps {
  /** The loaded index this rebuild invalidates. */
  cache: IndexCache;
  spawn: typeof spawn;
  /** How an abandoned build is ended. `killTree`, in the dev server. */
  kill: (child: ChildProcess) => void;
  /** How long the build gets. `REBUILD_TIMEOUT_MS`, in the dev server. */
  timeoutMs: number;
}

/**
 * How long the build gets before it is abandoned — the value the dev server's
 * `rebuildIndex` is bound with.
 *
 * Measured at 2.4 seconds, so five minutes is not a guess at the duration — it
 * is the answer to a build that is not going to finish at all, and it errs long
 * for the same reason the agent timeout does. Too short abandons a build that
 * would have succeeded, and what it leaves behind is genuinely unknown:
 * `killTree` ends the build, but the kill races the write, so the artifact on
 * disk afterwards may be the previous one, the new one, or a partial file — and
 * the editor is told the rebuild timed out in all three cases. Waiting costs
 * minutes. Guessing which of the three happened is what `rebuildIndex` below
 * refuses to do, which is why it drops the loaded index on this path too.
 */
const REBUILD_TIMEOUT_MS = 5 * 60_000;

/**
 * A rebuild: run `npm run build:index` in `root` and forget the loaded index,
 * so the next read comes off the new artifact.
 *
 * Never throws: a build that failed is a thing the editor needs *told*, beside
 * a readout of the words that were nevertheless written, rather than an
 * exception that loses both. The failure carries the build's own output because
 * that output names the input it choked on, and the reader is the maintainer
 * looking at their own repository.
 *
 * The cache is forgotten on **every** outcome, success or failure, and that is
 * deliberately not the cheaper rule it used to be. Keeping the copy on a
 * failure was justified by "a failed build leaves the previous artifact
 * standing", and this module cannot actually know that. A timed-out build is
 * killed mid-flight and may have written and swept before the kill landed; even
 * a non-zero exit can follow a completed `writeIndexArtifact`, which
 * `scripts/build-index.ts` calls before it prints the counts it ends on. What
 * the stale copy would then cost is the failure `web/builtIndex.ts` exists to
 * prevent — a day re-read from an index that has been superseded, or off a
 * content-addressed file the sweep has already deleted, reported as if it were
 * fresh. Against that, the rejected optimisation was worth half a second of
 * re-parse on a path the editor has to act on anyway.
 */
export function makeRebuild(deps: RebuildDeps): (root: string) => Promise<RebuildResult> {
  return (root) =>
    new Promise((settle) => {
      const child = deps.spawn("npm", ["run", "build:index"], { cwd: root, shell: true });
      let output = "";
      let settled = false;
      const done = (result: RebuildResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        deps.cache.forget();
        settle(result);
      };

      const timer = setTimeout(() => {
        // `deps.kill`, not `child.kill()`: `shell: true` means the child held
        // here is the shell, and killing that alone would leave `npm` and the
        // build under it running — writing and sweeping the artifact long after
        // this route reported the rebuild abandoned. The dev server passes
        // `killTree`, which is the only thing in this codebase that ends a
        // process tree on Windows.
        deps.kill(child);
        done({
          ok: false,
          error: `npm run build:index did not finish within ${deps.timeoutMs / 60_000} minutes.`,
        });
      }, deps.timeoutMs);

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
 * The dev server's own loaded index, as an `IndexCache`.
 *
 * Assembled from `web/builtIndex.ts`'s three named exports rather than from the
 * instance behind them, so this goes through the same three functions the
 * editor plugins call. There is one parsed index in the dev server, and one way
 * to reach it.
 */
const devServerCache: IndexCache = {
  index: builtIndex,
  knownnessThreshold: builtKnownnessThreshold,
  forget: forgetBuiltIndex,
};

/** {@link makeRebuild} as the dev server runs it. See the module comment. */
export const rebuildIndex = makeRebuild({
  cache: devServerCache,
  spawn,
  kill: killTree,
  timeoutMs: REBUILD_TIMEOUT_MS,
});

/**
 * The end of the build's output, which is where a failure says what it was.
 * Bounded because this reaches a browser and a stack trace over a 370,000-word
 * input can be long; the last twenty lines have carried every real build
 * failure this project has had.
 */
function tail(output: string): string {
  return output.split(/\r?\n/).slice(-20).join("\n").trim();
}
