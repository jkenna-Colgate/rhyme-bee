/**
 * The reviewed schedule artifact, as the dev server's editor routes read it.
 *
 * Byte-identical in three plugins before this — `editorDayPlugin.ts`,
 * `editorTierPlugin.ts` and `editorAddPlugin.ts` — each carrying its own doc
 * comment explaining that it was a copy, and each explaining the same two
 * things. They are worth stating once.
 *
 * ## Read per request, rather than held
 *
 * `data/schedule.json` is a small hand-edited file, and the Editor's Pass edits
 * it: an editor who has just corrected a day should see the correction on the
 * next reload rather than after restarting the dev server. Nothing else here is
 * re-read per request — the Rhyme Index is fifteen megabytes and is cached
 * (`web/builtIndex.ts`), the prevalence norms are 62k pinned rows and are
 * cached — and the difference is that this is the one artifact a maintainer
 * changes while the server is running.
 *
 * ## Why not `scripts/editorShell.ts`'s `loadSchedule`
 *
 * Because it answers an unreadable artifact with `process.exit(1)`. That is the
 * right answer for a command, whose caller is a terminal and whose whole job
 * was the schedule — and the wrong one for a dev server, which would take the
 * player's shell down with it over a file the player's shell never asked for.
 * Throwing instead leaves the failure where the route can turn it into a 500,
 * with the path named, which is `relayCause`'s case exactly.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSchedule, type Schedule } from "../src/schedule.ts";
import { repoRoot } from "./repoRoot.ts";

export function readSchedule(): Schedule {
  const path = resolve(repoRoot, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) throw new Error(`${path} is not a readable schedule artifact.`);
  return parsed;
}
