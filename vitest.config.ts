import { configDefaults, defineConfig } from "vitest/config";

/**
 * The suite is `src/__tests__`, `scripts/__tests__` and the shell's tests under
 * `web/` — one Vitest run at the repo root covers all three, because `web/`
 * imports the engine's TypeScript source directly and needs no build step.
 *
 * This file exists for its one exclusion. Implementation agents work in git
 * worktrees under `.claude/worktrees/`, each a full checkout with its own copy
 * of every test file, and Vitest's default glob happily walks into them: with
 * seven worktrees present a bare `npm test` reported 242 files and 3625 tests
 * against a real suite of 40 and 616. It passed, which is the dangerous part —
 * the number is wrong in the reassuring direction, and it counts a stale agent
 * branch's tests as evidence about this one.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
