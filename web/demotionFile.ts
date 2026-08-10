/**
 * The demotion list's file IO: reading `data/demotions.txt` and **appending one
 * entry to it**. `src/demotions.ts` owns the format and stays pure — the two
 * reasons, the serialise, the parse, the stage that applies the list over the
 * upstream word set — and this is the one module that puts that format on a
 * disk.
 *
 * It sits beside `web/tierOverrideFile.ts` and is deliberately not in `src/`,
 * for the reason that module gives: the engine reads the list at build time
 * through text handed to `manufactureIndexData` and never touches a path, and
 * the only writer is the Editor's Pass, which is a browser tool (ADR-0016)
 * served by a dev-only Vite plugin.
 *
 * ## The append is repaired, never trusted
 *
 * `serialiseDemotion` returns a newline-**terminated** line, which makes an
 * append correct only if what is already on disk also ends in a newline. If it
 * does not, the two entries fuse into one line of four fields and
 * `parseDemotions` throws over it — correctly, since a word quietly dropped
 * would leave a name being served as an Answer, which is the defect the file
 * exists to fix. But the throw is over the **whole file**, so one fused line
 * stops `npm run build:index` and takes every demotion with it.
 *
 * That is not a theoretical hazard here. #160 puts **no un-demote in the tool**
 * on purpose: reversing a demotion is a hand edit, so this file is designed to
 * be opened in an editor between two machine appends, and an editor that trims
 * the trailing newline is the whole of the failure. (`data/tier-overrides.csv`
 * met the same trap from a different direction — see `tierOverrideFile.ts`.)
 *
 * So the last byte is checked before every append, and a missing newline is
 * repaired by writing one first. The alternative — teaching the parser to split
 * a fused line — was rejected there and is rejected here: a parser that
 * tolerates a fused line cannot tell corruption from data. Repairing on write
 * keeps the parser strict and the file readable, and costs one read of a file
 * that is a couple of KB.
 *
 * There is no header to write, which is the one way this differs from the
 * override file's append: the format is two columns of plain text and the file
 * carries a hand-written comment block instead. A comment is not something a
 * machine should author, so an absent file simply gets its first entry.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { serialiseDemotion, type Demotion } from "../src/demotions.ts";

/**
 * The file's text, or `""` when there is no file.
 *
 * A missing file is "no demotions", not an error — the same call
 * `scripts/build-index.ts` makes with `readOptional`, and for the same reason:
 * every one of the build's hand-curated inputs is allowed not to exist.
 */
export function readDemotionText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * What has to be written *before* an entry, given whatever is already on disk.
 *
 * Two cases, and they are the two ways an append can go wrong:
 *
 * - **A file that does not end in a newline** — a newline goes first. This is
 *   the repair, and it is the whole reason this function exists. It covers the
 *   quiet form of the failure as well as the loud one: a last line ending in a
 *   hand-written `#` gloss would otherwise swallow the appended entry into its
 *   comment, demoting nothing and saying nothing.
 * - **Anything else, including no file at all** — nothing goes first.
 *
 * A file holding only whitespace counts as empty, matching the override file's
 * own `appendPrefix`: `parseDemotions` skips blank lines, so a whitespace-only
 * file is "no demotions" and an entry appended after them should not become a
 * stray blank first line the maintainer's diff has to explain.
 *
 * Separated from the write so the decision can be read on its own.
 */
function appendPrefix(existing: string): string {
  if (existing.trim() === "") return "";
  return existing.endsWith("\n") ? "" : "\n";
}

/**
 * Append one demotion, repairing the file's ending first if it needs it.
 *
 * Append rather than rewrite: `data/demotions.txt` is committed hand-curated
 * data with comments in it, and rewriting it from parsed entries would drop
 * every gloss the maintainer wrote and open a crash window over the lot. The
 * prefix is written in the *same* `appendFileSync` call as the entry, so there
 * is no window in which the file has gained a bare newline and not the entry it
 * was repaired for.
 *
 * A file that is empty, absent, or holds only whitespace is written rather than
 * appended to — the same whitespace-only case `appendPrefix` treats as empty —
 * so neither an empty string nor stray whitespace on disk survives at the top
 * of a file the maintainer reads in a diff, and a whitespace-only file with no
 * trailing newline cannot fuse the appended entry onto it.
 */
export function appendDemotion(path: string, demotion: Demotion): void {
  const existing = readDemotionText(path);
  const line = appendPrefix(existing) + serialiseDemotion(demotion);
  if (existing.trim() === "") writeFileSync(path, line);
  else appendFileSync(path, line);
}
