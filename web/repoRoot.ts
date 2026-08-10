/**
 * The repository root, as every module under `web/` computes it.
 *
 * `resolve(dirname(fileURLToPath(import.meta.url)), "..")` was written out six
 * times — in all five editor plugins and in `builtIndex.ts` — and every copy
 * meant the same thing, because every copy sat one directory below the root. It
 * is `import.meta.url` rather than `process.cwd()` on purpose: the dev server's
 * working directory is whatever the maintainer happened to be standing in when
 * they ran `npm run dev`, and a path from it would resolve `data/` somewhere
 * else entirely. The module's own location is a fact about the repository; the
 * shell's is a fact about the shell.
 *
 * That this module is itself in `web/` is what makes the `".."` correct here,
 * and is why importing it is not the same as importing a constant somebody
 * computed elsewhere: the value is derived at the one place whose depth it
 * depends on.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
