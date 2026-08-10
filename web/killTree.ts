/**
 * The one place this codebase knows how to end a child process reliably on
 * Windows.
 *
 * It lived in `scripts/editorAdd.ts`, beside the agent shell-out that first
 * needed it, and both of its runtime callers are here in `web/` — a process
 * utility is not part of what adding a word means, and reaching into a
 * `scripts/` module to find one said otherwise (#171).
 */

import { spawn, type ChildProcess } from "node:child_process";

/**
 * End the abandoned child, so it does not outlive the command that asked it a
 * question. `shell: true` is what lets a `.cmd` shim be found on Windows — but
 * it also means the child the caller holds is the shell, and killing that alone
 * would orphan the real process under it. `taskkill /t` takes the tree.
 * Elsewhere the shell execs the command in place, so the signal reaches the
 * process directly.
 *
 * Three callers, and not for the same reason. `scripts/editorAdd.ts` spawns
 * `claude -p` with `shell: true`, which is the accommodation this function was
 * written for. `web/indexRebuild.ts` spawns `npm run build:index` with the same
 * `shell: true` for the same Windows reason, and so inherits the same orphan —
 * a second copy there would be the mitigation drifting away from the
 * accommodation that forces it. `web/workingTree.ts` spawns `git` directly,
 * with no shell in the way and so no orphan to close; it reuses this anyway,
 * because `taskkill /pid … /f /t` is the only place in this codebase that knows
 * how to end a child reliably on Windows, and writing a second copy for a
 * one-process case would still be a second thing to keep correct, not a smaller
 * one. This is not the one place that knows what killing a *shelled* child
 * costs — `web/indexRebuild.ts` argues that for its own case, and
 * `web/workingTree.ts` has no shell to argue it about — but it stays the one
 * place the kill itself is implemented.
 */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]).on("error", () => {});
  } else {
    child.kill();
  }
}
