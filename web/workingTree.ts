/**
 * Asking git what it thinks of a handful of paths — the second half of the
 * status readout (#162), beside `indexStaleness`.
 *
 * ## Why this reads git at all, when the ticket bans git operations
 *
 * #162's last acceptance criterion is "no deploy button, no commit, and no git
 * operation anywhere in the tool", and its second is "the editor shows whether
 * each of the three written files carries uncommitted changes". Taken flat the
 * two contradict each other, because *uncommitted* is not a property of a file
 * — it is a property of a file **relative to a repository's history**, and
 * nothing but the repository knows it.
 *
 * The reading taken here is that the ban is on **mutating** git, which is what
 * the ticket's own body says in the sentence the criterion compresses: "The
 * editor does not deploy and does not commit. The sequence stays: judge, read
 * the diff, commit, deploy." Every act in that ban writes — a commit, a push, a
 * deploy — and every one of them takes a decision away from the maintainer that
 * the ticket is explicit about keeping. A read takes nothing away. It is how
 * "did I commit last night's pass?" stops being something to remember, which is
 * the criterion above it, word for word.
 *
 * Two non-git mechanisms were considered and both are worse:
 *
 * **Comparing modification times** — is the file newer than the last commit? —
 * cannot answer the question at all. A file restored from a backup, checked out
 * fresh, or merely re-saved with no edit is newer and identical; a file edited
 * and then given an old mtime is older and different. It would report a state
 * that looks like an answer and is not, which is the worst outcome available on
 * a screen whose entire purpose is to be believed.
 *
 * **Hashing the file against `git show HEAD:<path>`** does answer it, and is
 * *also a git invocation* — so it buys nothing against a ban read literally,
 * and costs accuracy against a ban read as this one is: it compares against the
 * last commit only, so it cannot see a staged change, and it has no answer at
 * all for a file git has never tracked. `data/tier-overrides.csv` is exactly
 * that file on the first night of a pass. Reimplementing the comparison by
 * parsing `.git/index` directly is the third option and is not honest work: it
 * is a second, worse git, written to avoid saying the word.
 *
 * ## What keeps this read a read
 *
 * `--no-optional-locks` is git's own flag for tools in this position — it is
 * what editors and shell prompts pass — and it stops `status` taking the index
 * lock to refresh its stat cache. Without it a `git status` racing a
 * maintainer's `git add` in another window can make one of them wait or fail.
 * With it, this process cannot write a byte anywhere in `.git`.
 *
 * The argv is fixed except for the paths, and those come from `WRITTEN_FILES`,
 * a constant. Nothing a browser sends reaches this function, and there is no
 * shell for anything to be interpolated into — unlike `web/indexRebuild.ts`,
 * which needs `shell: true` to find `npm`'s `.cmd` shim on Windows, `git` is an
 * ordinary executable on the PATH and is spawned directly.
 */

import { spawn } from "node:child_process";
import { killTree } from "../scripts/editorAdd.ts";

/**
 * How long git gets before the question is abandoned.
 *
 * `status` over four named paths is milliseconds. Five seconds is not a guess
 * at the duration; it is the answer to a `git` that is never going to reply —
 * a repository mid-rebase behind a stale lock, or a filesystem that has stopped
 * answering. What matters is that it *ends*: this runs on every status read,
 * and a hung child per read would accumulate behind a screen the editor leaves
 * open all evening.
 */
const GIT_TIMEOUT_MS = 5_000;

/**
 * The porcelain lines git prints for `paths`, or `null` when git could not be
 * asked.
 *
 * Never throws, and never relays a word of what git said on failure. That is
 * not tidiness: `git`'s errors are the richest source of environment leakage in
 * this route — "fatal: not a git repository (or any of the parent directories)"
 * and its neighbours quote absolute paths, and a spawn failure on Windows
 * quotes the whole PATH lookup. The caller has no use for any of it. What it
 * needs is the one bit this returns, and `writtenStatus`
 * (`web/editorStatusReport.ts`) turns that bit into a state the screen says out
 * loud rather than into a silent "nothing to commit".
 *
 * `--ignored=matching` rather than a bare `--ignored`: with an explicit
 * pathspec of files the two agree, and naming the mode is what keeps them
 * agreeing — `traditional` collapses an ignored *directory* into one line, and
 * a written file that ended up inside one would then be reported as absent
 * rather than as ignored.
 */
export function uncommittedPorcelain(
  root: string,
  paths: readonly string[],
): Promise<string | null> {
  return new Promise((settle) => {
    const child = spawn(
      "git",
      ["--no-optional-locks", "status", "--porcelain", "--ignored=matching", "--", ...paths],
      { cwd: root },
    );

    let output = "";
    let settled = false;
    const done = (result: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(result);
    };

    const timer = setTimeout(() => {
      killTree(child);
      done(null);
    }, GIT_TIMEOUT_MS);

    // `setEncoding` first: without it each chunk is a `Buffer`, and `+=`
    // decodes it to a string on its own — correct for the four ASCII paths
    // this route ever passes git, but a multi-byte character split across two
    // chunks would decode wrong on both sides of the split. `setEncoding`
    // hands the stream Node's own `StringDecoder`, which holds a partial
    // sequence back until the rest of it arrives.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    // Read and discarded. Left unbound it would fill the pipe buffer and stall
    // a child that had plenty to say, which is the one way a five-second
    // timeout could be reached by a `git` that was working perfectly.
    child.stderr.on("data", () => {});
    child.on("error", () => done(null));
    child.on("close", (code) => done(code === 0 ? output : null));
  });
}
